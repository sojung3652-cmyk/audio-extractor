import { NativeModule, requireNativeModule } from 'expo';

import type { AudioExtractorEvents } from './AudioExtractor.types';

declare class AudioExtractorModule extends NativeModule<AudioExtractorEvents> {
  /**
   * Extracts the audio track from a video file into an .m4a file at `outputPath`,
   * without re-encoding. Both paths must be plain filesystem paths (no `file://` scheme).
   */
  extractAudio(inputPath: string, outputPath: string): Promise<string>;
}

export default requireNativeModule<AudioExtractorModule>('AudioExtractor');
