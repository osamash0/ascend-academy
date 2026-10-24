import io
import logging
import edge_tts

logger = logging.getLogger(__name__)

async def generate_speech(text: str, voice: str = "en-US-AvaNeural") -> bytes:
    """
    Generates audio bytes for the given text using edge-tts.
    
    Args:
        text: The text to convert to speech.
        voice: The edge-tts voice identifier.
        
    Returns:
        Bytes object containing the MP3 audio data.
    """
    if not text.strip():
        raise ValueError("No text to speak.")
        
    try:
        communicate = edge_tts.Communicate(text, voice)
        audio_data = io.BytesIO()
        
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.write(chunk["data"])
                
        audio_data.seek(0)
        return audio_data.getvalue()
    except Exception as e:
        # Zero bytes used to stream as a silent "success"; fail instead.
        logger.error("Speech generation failed: %s", e)
        raise
