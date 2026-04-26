import codecs

with codecs.open("backend/services/ai_service.py", "r", "utf-8") as f:
    text = f.read()

# 1. Imports
text = text.replace(
    'try:\n    from google import genai',
    'try:\n    from groq import Groq\n    groq_client = Groq()\nexcept Exception:\n    groq_client = None\n\nGROQ_MODEL = "llama3-8b-8192"\n\ntry:\n    from google import genai'
)

# 2. enhance_slide_content
text = text.replace(
    'if ai_model == "gemini-2.5-flash" and client:\n        try:\n            res = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)',
    'if ai_model == "groq" and groq_client:\n        try:\n            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])\n            return res.choices[0].message.content.strip()\n        except Exception as e:\n            print(f"DEBUG Groq error: {e}")\n            return raw_text\n    elif ai_model == "gemini-2.5-flash" and client:\n        try:\n            res = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)'
)

# 3. process_slide_batch
text = text.replace(
    'if ai_model == "gemini-2.5-flash" and client:\n        try:\n            res = client.models.generate_content(\n                model=GEMINI_MODEL,\n                contents=prompt,\n                config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=SlideBatchResult)\n            )\n            return json.loads(res.text)',
    '''if ai_model == "groq" and groq_client:
        try:
            res = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            return __import__('json').loads(res.choices[0].message.content)
        except Exception as e:
            print(f"DEBUG Groq batch error: {e}")
            return default_res
    elif ai_model == "gemini-2.5-flash" and client:
        try:
            res = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=SlideBatchResult)
            )
            return json.loads(res.text)'''
)

# 4. generate_summary
text = text.replace(
    'if ai_model == "gemini-2.5-flash" and client:\n        try:\n            res = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)\n            return res.text.strip()',
    '''if ai_model == "groq" and groq_client:
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            return res.choices[0].message.content.strip()
        except Exception as e:
            print(f"DEBUG Groq summary error: {e}")
            return "Failed to generate summary."
    elif ai_model == "gemini-2.5-flash" and client:
        try:
            res = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
            return res.text.strip()'''
)

# 5. generate_quiz
text = text.replace(
    'if ai_model == "gemini-2.5-flash" and client:\n        prompt = f"""You are an educational assistant. Based on the following slide content, create one multiple-choice quiz question with exactly 4 options. The options should be plausibly confusing except for the single correct answer.',
    '''if ai_model == "groq" and groq_client:
        groq_prompt = f"""You are an educational assistant. Based on the following slide content, create one multiple-choice quiz question with exactly 4 options (A, B, C, D).\\nFocus ONLY on the educational/academic content. Do NOT create questions about instructor names, dates, or administrative information.\\nReturn your answer as valid JSON with this exact structure:\\n{{\\n  "question": "your question here",\\n  "options": ["option A text", "option B text", "option C text", "option D text"],\\n  "correctAnswer": 0\\n}}\\nThe correctAnswer field must be the 0-indexed position of the correct option (0=A, 1=B, 2=C, 3=D). Return ONLY the JSON object.\\nSlide content:\\n{slide_text}"""
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": groq_prompt}], response_format={"type": "json_object"})
            return __import__('json').loads(res.choices[0].message.content)
        except Exception as e:
            print(f"DEBUG Groq quiz error: {e}")
    elif ai_model == "gemini-2.5-flash" and client:
        prompt = f"""You are an educational assistant. Based on the following slide content, create one multiple-choice quiz question with exactly 4 options. The options should be plausibly confusing except for the single correct answer.'''
)

# 6. generate_slide_title
text = text.replace(
    'if ai_model == "gemini-2.5-flash" and client:\n        try:\n            res = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)\n            return res.text.strip().strip(\'"\\\'\') or None',
    '''if ai_model == "groq" and groq_client:
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            title = res.choices[0].message.content.strip().strip('"\\'')
            return title if title else None
        except Exception as e:
            print(f"DEBUG Groq title error: {e}")
            return None
    elif ai_model == "gemini-2.5-flash" and client:
        try:
            res = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
            return res.text.strip().strip('"\\'') or None'''
)

# 7. generate_analytics_insights
text = text.replace(
    'if ai_model == "gemini-2.5-flash" and client:\n        try:\n            res = client.models.generate_content(',
    '''if ai_model == "groq" and groq_client:
        groq_prompt = prompt + """\\nReturn ONLY valid JSON with this exact structure:\\n{\\n  "summary": "...",\\n  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"]\\n}"""
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": groq_prompt}], response_format={"type": "json_object"})
            return __import__('json').loads(res.choices[0].message.content)
        except Exception as e:
            print(f"DEBUG Groq analytics error: {e}")
    elif ai_model == "gemini-2.5-flash" and client:
        try:
            res = client.models.generate_content('''
)

# 8. chat_with_lecture
text = text.replace(
    'if ai_model == "gemini-2.5-flash" and client:\n        try:\n            res = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)',
    '''if ai_model == "groq" and groq_client:
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            return res.choices[0].message.content.strip()
        except Exception as e:
            print(f"DEBUG Groq chat error: {e}")
            return "I'm sorry, I'm having trouble connecting to my knowledge base right now. Please try again in a moment!"
    elif ai_model == "gemini-2.5-flash" and client:
        try:
            res = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)'''
)

with codecs.open("backend/services/ai_service.py", "w", "utf-8") as f:
    f.write(text)
print("PATCH_SUCCESS")
