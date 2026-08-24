import { registerWebModule, NativeModule } from 'expo';

// AudioExtractorModule is not available on the web platform.
class AudioExtractorModule extends NativeModule<{}> {
  async extractAudio(_inputPath: string, _outputPath: string): Promise<string> {
    throw new Error('AudioExtractor is not supported on web.');
  }
}

export default registerWebModule(AudioExtractorModule, 'AudioExtractorModule');
