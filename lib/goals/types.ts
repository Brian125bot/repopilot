// GoalExtracted — Gemini's structured output for a goal
export type GoalExtracted = {
  title: string;                  // "UNCLEAR" when too vague
  scope: string[];                // list of scope areas / modules touched
  acceptanceCriteria: string[];   // list of testable criteria
  assumptions: string[];          // Gemini's declared guesses (COR-52: no invented numbers)
  ambiguityFlags: string[];       // non-empty when title === "UNCLEAR"
};

// Goal — persisted vault record, keyed by sessionId
export type Goal = {
  sessionId: string;
  rawText: string;                // always preserved
  extracted: GoalExtracted | null;// null on "Skip extraction" path
  createdAt: string;              // ISO 8601
  updatedAt: string;              // ISO 8601
};
