import io
import edge_tts

async def generate_speech(text: str, voice: str = "en-US-AvaNeural") -> bytes:
    """Generates audio bytes for the given text using edge-tts."""
    communicate = edge_tts.Communicate(text, voice)
    audio_data = io.BytesIO()
    
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data.write(chunk["data"])
            
    audio_data.seek(0)
    return audio_data.getvalue()
