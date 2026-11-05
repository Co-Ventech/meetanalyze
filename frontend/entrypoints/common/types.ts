export interface TranscriptTurn {
  id: string;
  speaker: string;     // e.g. "Ahil (You)" or "Arsalan"
  isSelf: boolean;     // true if spoken by local user, false if client
  text: string;
  timestamp: string;   // e.g. "2:34 PM"
  startMs?: number;
  endMs?: number;
  systemNotice?: boolean; // true for join/leave or call status notices
  cluster?: string;       // AssemblyAI acoustic cluster e.g. "A", "B"
  turnOrder?: number;     // AssemblyAI turn_order for SpeakerRevision mapping
}

export interface PartialTranscriptState {
  speaker: string;
  isSelf: boolean;
  text: string;
}

export interface SpeakerInterval {
  speaker: string;
  start: number;      // epoch ms
  end: number;        // epoch ms
}

export interface RecentJoiner {
  name: string;
  joinedAt: number;   // epoch ms
}

export interface SpeakerInfo {
  selfName: string;
  activeSpeaker: string | null;
  allParticipants: string[];
  guests: string[];
  guestOverride?: string;
  intervals?: SpeakerInterval[];
  recentJoiners?: RecentJoiner[];
  newlyJoined?: string[];
  leftParticipants?: string[];
}
