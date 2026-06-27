export type MatchStatus = "AUTO" | "APPROVED" | "REJECTED" | "CONTESTED" | "HIDDEN_OPTOUT";

export type PersonStatus =
  | "ACTIVE"
  | "UNDER_REVIEW"
  | "OPTOUT_LIMITED"
  | "REMOVED";

export type SuggestionStatus =
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "MERGED"
  | "NEEDS_MORE_INFO";

export type BBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type FaceMatch = {
  person_id: string;
  name: string;
  slug: string;
  score: number;
  profile_url: string;
  status?: MatchStatus;
};

export type FaceResult = {
  face_id: string;
  bbox: BBox;
  matches: FaceMatch[];
};

export type AnalyzeResult = {
  image_url: string;
  image_id: string;
  faces: FaceResult[];
  suggestions_enabled: boolean;
};

export type AnalyzeResponse = {
  article_id: string;
  results: AnalyzeResult[];
  warnings: string[];
};
