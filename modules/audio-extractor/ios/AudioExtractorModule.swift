import ExpoModulesCore
import AVFoundation

internal final class AudioTrackNotFoundException: Exception {
  override var reason: String {
    "The selected file does not contain an audio track."
  }
}

internal final class ExportSessionCreationException: Exception {
  override var reason: String {
    "Could not create an export session for the selected file."
  }
}

internal final class ExportFailedException: GenericException<String> {
  override var reason: String {
    "Audio export failed: \(param)"
  }
}

public class AudioExtractorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioExtractor")

    AsyncFunction("extractAudio") { (inputPath: String, outputPath: String, promise: Promise) in
      let asset = AVURLAsset(url: URL(fileURLWithPath: inputPath))

      Task {
        do {
          let audioTracks = try await asset.loadTracks(withMediaType: .audio)
          if audioTracks.isEmpty {
            promise.reject(AudioTrackNotFoundException())
            return
          }

          guard let exportSession = AVAssetExportSession(
            asset: asset,
            presetName: AVAssetExportPresetAppleM4A
          ) else {
            promise.reject(ExportSessionCreationException())
            return
          }

          let outputURL = URL(fileURLWithPath: outputPath)
          try? FileManager.default.removeItem(at: outputURL)

          exportSession.outputURL = outputURL
          exportSession.outputFileType = .m4a

          exportSession.exportAsynchronously {
            switch exportSession.status {
            case .completed:
              promise.resolve(outputPath)
            case .failed, .cancelled:
              let message = exportSession.error?.localizedDescription ?? "unknown error"
              promise.reject(ExportFailedException(message))
            default:
              promise.reject(ExportFailedException("unexpected export status"))
            }
          }
        } catch {
          promise.reject(ExportFailedException(error.localizedDescription))
        }
      }
    }
  }
}
