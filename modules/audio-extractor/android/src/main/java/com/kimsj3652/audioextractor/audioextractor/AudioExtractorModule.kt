package com.kimsj3652.audioextractor.audioextractor

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.ByteBuffer

class AudioTrackNotFoundException :
  CodedException("The selected file does not contain an audio track.")

class AudioExtractorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AudioExtractor")

    AsyncFunction("extractAudio") { inputPath: String, outputPath: String ->
      extractAudioTrack(inputPath, outputPath)
      outputPath
    }
  }

  // Remuxes the audio track into an .m4a container without re-encoding,
  // equivalent to `ffmpeg -vn -c:a copy`.
  private fun extractAudioTrack(inputPath: String, outputPath: String) {
    val extractor = MediaExtractor()
    extractor.setDataSource(inputPath)

    var audioTrackIndex = -1
    var audioFormat: MediaFormat? = null
    for (i in 0 until extractor.trackCount) {
      val format = extractor.getTrackFormat(i)
      val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith("audio/")) {
        audioTrackIndex = i
        audioFormat = format
        break
      }
    }

    if (audioTrackIndex == -1 || audioFormat == null) {
      extractor.release()
      throw AudioTrackNotFoundException()
    }

    extractor.selectTrack(audioTrackIndex)

    val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    val muxerTrackIndex = muxer.addTrack(audioFormat)
    muxer.start()

    val buffer = ByteBuffer.allocate(1 shl 20)
    val bufferInfo = MediaCodec.BufferInfo()

    try {
      while (true) {
        val sampleSize = extractor.readSampleData(buffer, 0)
        if (sampleSize < 0) break

        bufferInfo.offset = 0
        bufferInfo.size = sampleSize
        bufferInfo.presentationTimeUs = extractor.sampleTime
        bufferInfo.flags = extractor.sampleFlags

        muxer.writeSampleData(muxerTrackIndex, buffer, bufferInfo)
        extractor.advance()
      }
    } finally {
      muxer.stop()
      muxer.release()
      extractor.release()
    }
  }
}
