export interface NowPlayingState {
  status: 'idle' | 'detecting' | 'playing' | 'silence_grace';
  artist: string;
  album: string;
  title: string;
  artUrl: string;
  mbid?: string;
  sourceType?: 'vinyl' | 'tape' | 'cd' | 'aux';
  isContinuous: boolean;
  sideLocked: boolean;
  playCount?: number;
  rmsLevel: number;
  sampleRate: number;
  bitDepth: number;
  inputDeviceName: string;
  matchedVia?: 'local_override' | 'musicbrainz' | 'shazam' | 'idle_default';
  startedAt?: string;
}

export interface ToneControls {
  inputGainDb: number;      // -12dB to +12dB
  bassGainDb: number;       // -12dB to +12dB (100 Hz shelf)
  midGainDb: number;        // -12dB to +12dB (1 kHz peaking)
  trebleGainDb: number;     // -12dB to +12dB (10 kHz shelf)
  selectedDeviceId: string;
  deviceList: AudioDevice[];
}

export interface AudioDevice {
  id: string;
  name: string;
  cardIndex: number;
  supportedRates: number[];
  isDefault: boolean;
  channels: number;
}

export interface AudioLevelData {
  rms: number;
  rawRms: number;
  dbfs: number;
  peakDbfs: number;
  leftPeakDbfs?: number;
  rightPeakDbfs?: number;
  gainDb: number;
  isClipping: boolean;
  isHot: boolean;
  isOptimal: boolean;
  status: 'playing' | 'idle' | 'detecting' | 'silence_grace';
  source?: string;
  timestamp: number;
}

export interface ReleaseOverride {
  trackKey: string;
  customArtist: string;
  customAlbum: string;
  customArtUrl?: string;
  releaseMbid?: string;
  format?: string;
  year?: string;
  updatedAt: string;
}

export interface MusicBrainzCandidate {
  id: string;
  title: string;
  artist: string;
  year: string;
  format: string;
  isFullAlbum: boolean;
  isCompilation: boolean;
  typeLabel: string;
  artUrl?: string;
  score?: number;
  sideOpener?: string;
  trackCount?: number;
  releaseGroupMbid?: string;
}

export interface PlaySession {
  id: string;
  artist: string;
  album: string;
  firstTrack: string;
  artUrl: string;
  playedAt: string;
  playCount: number;
  mbid?: string;
  hasOverride: boolean;
}

export interface OwnToneOutput {
  id: string;
  name: string;
  type: 'airplay' | 'chromecast' | 'bluetooth' | 'local' | 'raop';
  selected: boolean;
  volume: number;
  isFavorite?: boolean;
}

export interface SystemPreferences {
  sourceType: 'vinyl' | 'tape' | 'cd' | 'aux';
  customStreamLabel: string;
  defaultArtUrl: string;
  idleArtist: string;
  idleAlbum: string;
  idleTitle: string;
  enableRecognition: boolean;
  sampleDuration?: number;
  continuousId: boolean;
  silenceGapSeconds: number;
  dimMinutes: number;
  idleFadeSeconds: number;
  owntoneHost: string;
  owntonePort: number;
  enableToneDsp: boolean;
}
