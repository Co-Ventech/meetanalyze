export interface TranscriptTurn {
  id: string;
  speaker: string;     // e.g. "Aahil Alwani (You)" or "Sarah Connor"
  isSelf: boolean;     // true if spoken by local user, false if guest
  text: string;
  timestamp: string;   // e.g. "2:34 PM"
}

export interface PartialTranscriptState {
  speaker: string;
  isSelf: boolean;
  text: string;
}

export interface SpeakerInfo {
  selfName: string;
  activeSpeaker: string | null;
  allParticipants: string[];
  guests: string[];
}

