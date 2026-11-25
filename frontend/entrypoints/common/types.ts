export interface TranscriptTurn {
  id: string;
  speaker: string;     // name shown in Google Meet captions, e.g. "Arsalan"
  isSelf: boolean;     // true if spoken by the local user
  text: string;
  timestamp: string;   // e.g. "2:34 PM"
  startMs?: number;    // epoch ms when the caption block first appeared
  endMs?: number;      // epoch ms of the last caption update for this turn
  systemNotice?: boolean; // true for join/leave or call status notices
}

export interface PartialTranscriptState {
  speaker: string;
  isSelf: boolean;
  text: string;
}

/** Meeting metadata recorded by the content script while capturing captions. */
export interface CaptureMeta {
  meetCode: string;
  title: string;
  startedAt: number;   // epoch ms
  endedAt?: number;    // epoch ms
  selfName: string;
  participants: string[];
}

/** State the content script persists in chrome.storage.local under these keys. */
export interface CaptureStorage {
  isRecording: boolean;
  captionsOn: boolean;
  partialTranscript: PartialTranscriptState | null;
  finalTranscripts: TranscriptTurn[];
  captureMeta: CaptureMeta | null;
  captureError: string | null;
}
