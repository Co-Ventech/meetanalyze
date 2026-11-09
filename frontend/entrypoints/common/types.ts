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
  unresolved?: boolean;   // true while a remote turn only has a placeholder label ("Speaker A" / "Client")
  resolvedBy?: 'cluster' | 'elimination' | 'captions' | 'active-speaker' | 'single-guest' | 'meet-api' | 'manual';
  sessionId?: string;     // recording session the turn came from (cluster letters are per-session)
  // Direct per-turn evidence for who spoke (cluster names are a weighted vote over this)
  evidenceName?: string;
  evidenceSource?: 'captions' | 'single-guest' | 'manual' | 'meet-api';
  // Weak hint (partial caption overlap / tile indicator) used only when nothing better exists
  weakName?: string;
  weakBy?: 'captions' | 'active-speaker';
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
  // 'captions' = Meet live caption speaker (most reliable), 'active' = tile speaking indicator
  source?: 'captions' | 'active';
  isSelf?: boolean;
}

// Pending post-meeting relabel job using the Google Meet REST API
export interface MeetRelabelJob {
  meetingCode: string;
  startedAt: number;  // epoch ms when recording started
  stoppedAt: number;  // epoch ms when recording stopped
  attempts: number;
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
