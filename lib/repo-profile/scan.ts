import { RepoProfile, ConventionEntry } from '@/lib/types/steering';
import { parsePackageJson, parseCommits, detectLintFormat } from './parsers';

export interface ScanOptions {
  githubPat: string;
  signal?: AbortSignal;
  onProgress?: (stage: string, message: string) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithBackoff(url: string, options: RequestInit, maxRetries = 1): Promise<Response> {
  let retries = 0;
  while (true) {
    const response = await fetch(url, options);

    if (response.status === 403 && retries < maxRetries) {
      const resetTime = response.headers.get('x-ratelimit-reset');
      let waitTime = 1000;
      if (resetTime) {
         const resetMs = parseInt(resetTime, 10) * 1000;
         waitTime = Math.max(1000, resetMs - Date.now() + 100);
      }

      // Cap the wait time to avoid infinite hanging if rate limited too long
      if (waitTime > 5000) {
        waitTime = 5000;
      }

      await sleep(waitTime);
      retries++;
      continue;
    }

    return response;
  }
}

export async function scanRepository(
  target: { owner: string; repo: string },
  options: ScanOptions
): Promise<RepoProfile & { incomplete?: boolean }> {
  const { githubPat, signal, onProgress } = options;
  const headers = {
    Authorization: `Bearer ${githubPat}`,
    Accept: 'application/vnd.github.v3+json',
  };

  const profile: RepoProfile & { incomplete?: boolean } = {
    id: `${target.owner}/${target.repo}`,
    repoRef: {
      owner: target.owner,
      repo: target.repo,
    },
    stack: {
      languages: [],
    },
    conventions: [],
    updatedAt: new Date().toISOString(),
    version: 1,
  };

  const createIncomplete = () => ({ ...profile, incomplete: true });

  try {
    // Stage 1: Metadata
    onProgress?.('metadata', 'Fetching repository metadata...');
    if (signal?.aborted) return createIncomplete();

    const repoRes = await fetchWithBackoff(`https://api.github.com/repos/${target.owner}/${target.repo}`, { headers, signal });
    if (repoRes.ok) {
      const repoData = await repoRes.json();
      profile.repoRef.defaultBranch = repoData.default_branch;
      profile.notes = repoData.description || '';
    } else {
       // if we can't even fetch the repo, we might just fail here or continue.
       // for resilience, we continue but warn.
       console.warn(`Failed to fetch repo metadata: ${repoRes.status}`);
    }

    if (signal?.aborted) return createIncomplete();

    const langsRes = await fetchWithBackoff(`https://api.github.com/repos/${target.owner}/${target.repo}/languages`, { headers, signal });
    if (langsRes.ok) {
      const langsData = await langsRes.json();
      profile.stack.languages = Object.keys(langsData);
    }

    // Stage 2: Manifest
    onProgress?.('manifest', 'Inspecting package.json...');
    if (signal?.aborted) return createIncomplete();

    const pkgRes = await fetchWithBackoff(`https://api.github.com/repos/${target.owner}/${target.repo}/contents/package.json`, { headers, signal });
    if (pkgRes.ok) {
      const pkgData = await pkgRes.json();
      if (pkgData.content) {
        const content = atob(pkgData.content);
        const manifest = parsePackageJson(content);

        if (manifest.packageManager) profile.stack.packageManager = manifest.packageManager;
        if (manifest.frameworks.length > 0) profile.stack.framework = manifest.frameworks.join(', ');

        if (manifest.frameworks.includes('jest') || manifest.frameworks.includes('vitest') || manifest.frameworks.includes('mocha')) {
             const runner = manifest.frameworks.find(f => ['jest', 'vitest', 'mocha'].includes(f));
             profile.stack.testRunner = runner;
        }

        const conventionBody = [
           manifest.name ? `Project Name: ${manifest.name}` : null,
           manifest.scripts.length > 0 ? `Available scripts: ${manifest.scripts.join(', ')}` : null,
        ].filter(Boolean).join('\n');

        if (conventionBody) {
            profile.conventions.push({
               id: 'manifest',
               title: 'Project Manifest (package.json)',
               body: conventionBody,
               source: 'package.json'
            });
        }
      }
    }

    // Stage 3: Commits
    onProgress?.('commits', 'Analyzing recent commits...');
    if (signal?.aborted) return createIncomplete();

    const commitsRes = await fetchWithBackoff(`https://api.github.com/repos/${target.owner}/${target.repo}/commits?per_page=30`, { headers, signal });
    if (commitsRes.ok) {
      const commitsData = await commitsRes.json();
      const messages = commitsData.map((c: any) => c.commit.message);
      const parsedCommits = parseCommits(messages);

      if (parsedCommits.conventional || parsedCommits.ticketPrefix) {
         let body = '';
         if (parsedCommits.conventional) body += 'Repository follows Conventional Commits.\n';
         if (parsedCommits.ticketPrefix) body += `Repository uses ticket prefixes (e.g. ${parsedCommits.samplePrefixes.join(', ')}).`;

         profile.conventions.push({
             id: 'commits',
             title: 'Commit Guidelines',
             body: body.trim(),
             source: 'git commits'
         });
      }
    }

    // Stage 4: Configuration
    onProgress?.('config', 'Detecting lint and formatting configuration...');
    if (signal?.aborted) return createIncomplete();

    const treeUrl = `https://api.github.com/repos/${target.owner}/${target.repo}/git/trees/${profile.repoRef.defaultBranch || 'main'}?recursive=0`;
    const treeRes = await fetchWithBackoff(treeUrl, { headers, signal });
    if (treeRes.ok) {
        const treeData = await treeRes.json();
        const files = treeData.tree.map((t: any) => t.path);

        const detected = detectLintFormat(files);
        let configBody = '';
        if (detected.eslint) configBody += 'Uses ESLint.\n';
        if (detected.prettier) configBody += 'Uses Prettier.\n';
        if (detected.biome) configBody += 'Uses Biome.\n';
        if (detected.editorconfig) configBody += 'Uses EditorConfig.\n';

        if (configBody) {
             profile.conventions.push({
                 id: 'lint-format',
                 title: 'Lint & Format Tooling',
                 body: configBody.trim(),
                 source: 'Root configs'
             });
        }
    }

    return profile;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return createIncomplete();
    }
    // For non-abort network errors, we log and return the partial profile constructed so far.
    console.warn(`Scan encountered an error: ${err.message}`);
    return createIncomplete(); // fail-soft even on exceptions to give partial data
  }
}
