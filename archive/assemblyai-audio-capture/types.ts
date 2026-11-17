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
  channel?: AudioChannel; // which AssemblyAI session produced the turn
}

export type AudioChannel = 'mic' | 'tab';

export type AttributionMethod =
  | 'mic-channel'
  | 'dropped-mic-bleed'
  | 'single-guest'
  | 'dom-overlap'
  | 'cluster-vote'
  | 'dom-active-now'
  | 'last-guest'
  | 'unresolved';

/** One emitted final turn plus every signal that went into naming its speaker. */
export interface AttributionLogTurn {
  turnId: string;
  channel: AudioChannel;
  text: string;
  startMs: number;          // epoch ms, from AssemblyAI word timestamps when `timed`
  endMs: number;
  timed: boolean;           // false = word timestamps missing, window is estimated
  emittedAt: number;        // epoch ms when the final Turn message arrived
  assigned: string;         // name shown when the turn was emitted
  method: AttributionMethod;
  cluster: string | null;
  speakerConfidence: number | null;
  domCandidates: { speaker: string; overlapMs: number }[];
  clusterVoteName: string | null;
  activeSpeakerAtEmit: string | null;
  guests: string[];
  micRms: number | null;
  tabRms: number | null;
  retroResolved?: { name: string; method: AttributionMethod; at: number };
  finalSpeaker: string | null; // name after all retroactive fixes, filled at export
  trueSpeaker: string | null;  // fill in by hand to build the labelled test set
}

export interface AttributionLogExport {
  format: 'meetanalyze-attribution-log/1';
  exportedAt: number;
  extensionVersion: string;
  selfName: string;
  constants: Record<string, number>;
  sessions: { channel: AudioChannel; startedAt: number; audioStartEpoch: number }[];
  turns: AttributionLogTurn[];
  domIntervals: SpeakerInterval[];
  rosterEvents: { at: number; type: 'joined' | 'left'; name: string }[];
  revisions: {
    at: number;
    turnId: string;
    turnOrder: number;
    fromCluster: string | null;
    toCluster: string;
    fromSpeaker: string;
    toSpeaker: string;
  }[];
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
