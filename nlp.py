"""
Chatbot logic for KaonCheck.
Handles detection intent, tracking conversation history, and talking to the AI.
"""

import json
import re
import ollama

# Just keeping track of how much history to send to the model
MODEL_NAME = "llama3.1"
MAX_HISTORY_MESSAGES = 10

# Quick lookup for nutrition info on the dishes we detect
FOOD_KNOWLEDGE = {
    # --- CHICKEN ---
    "adobong iga": {
        "category": "moderate",
        "risks": ["sodium from soy sauce", "fat from iga (rib) cuts"],
        "pair_with": ["gulay", "sabaw", "water", "1 cup rice"],
        "better_choice": ["chicken adobo with breast meat", "less soy sauce version"],
        "score": 6,
        "notes": "Tasty but the rib cut is fatty. Better with less soy sauce.",
    },
    "chicken inasal": {
        "category": "healthier",
        "risks": ["oil from basting", "sodium from marinade"],
        "pair_with": ["gulay", "sabaw", "water", "1 cup rice"],
        "better_choice": ["inasal with less oil basting", "remove skin before eating"],
        "score": 7,
        "notes": "Grilled is usually a win. Just watch the basting oil.",
    },
    "fried chicken": {
        "category": "fried",
        "risks": ["oil from deep frying", "sodium", "large portions"],
        "pair_with": ["gulay", "sabaw", "water", "1 cup rice"],
        "better_choice": ["inihaw na manok", "tinola", "air-fried chicken", "chicken inasal"],
        "score": 5,
        "notes": "The skin and breading soak up a lot of oil.",
    },
    # --- FISH ---
    "daing na bangus": {
        "category": "moderate",
        "risks": ["oil from frying", "sodium from salt curing"],
        "pair_with": ["gulay", "sabaw", "vinegar dip", "1 cup rice"],
        "better_choice": ["grilled bangus", "inihaw na bangus", "sinigang na bangus"],
        "score": 6,
        "notes": "Bangus has good fats, but frying it in oil adds a lot of calories.",
    },
    "pan fried tilapia": {
        "category": "moderate",
        "risks": ["oil from pan frying", "sodium from seasoning"],
        "pair_with": ["gulay", "sabaw", "water", "1 cup rice"],
        "better_choice": ["steamed tilapia", "sinigang na tilapia", "grilled tilapia"],
        "score": 6,
        "notes": "Good lean protein. Better if steamed or grilled instead of fried.",
    },
    "sinaing na tulingan": {
        "category": "healthier",
        "risks": ["sodium from salt", "slight bitterness if overcooked"],
        "pair_with": ["gulay", "moderate rice", "water"],
        "better_choice": ["sinaing with less salt and more kamias"],
        "score": 7,
        "notes": "Slow-cooked and healthy. Just don't go overboard with the salt.",
    },
    # --- PORK ---
    "breaded pork chop": {
        "category": "fried",
        "risks": ["oil from frying", "sodium", "breading adds carbs and calories"],
        "pair_with": ["gulay", "sabaw", "water", "1 cup rice"],
        "better_choice": ["grilled pork chop", "baked pork chop without breading"],
        "score": 5,
        "notes": "Breading is basically an oil sponge. Skip it if you can.",
    },
    "lechon kawali": {
        "category": "high-fat",
        "risks": ["saturated fat", "sodium", "cholesterol", "deep-fried pork belly"],
        "pair_with": ["atchara", "gulay", "water", "small rice"],
        "better_choice": ["grilled liempo", "inihaw na baboy", "lechon manok (roasted)"],
        "score": 4,
        "notes": "Super heavy. Definitely a 'once in a while' treat.",
    },
    "pork bistek": {
        "category": "moderate",
        "risks": ["sodium from soy sauce and calamansi marinade", "fat from pork cut"],
        "pair_with": ["gulay", "sabaw", "water", "1 cup rice"],
        "better_choice": ["bistek with leaner pork or chicken", "less soy sauce"],
        "score": 6,
        "notes": "The soy sauce marinade is a sodium bomb. Go light on it.",
    },
    # --- RICE ---
    "boiled rice": {
        "category": "staple",
        "risks": ["refined carbs if white rice", "large portions spike blood sugar"],
        "pair_with": ["any ulam", "gulay", "sabaw"],
        "better_choice": ["brown rice", "half-cup portion", "cauliflower rice"],
        "score": 6,
        "notes": "Standard fuel. Just keep the portion to around 1 cup.",
    },
    "fried rice": {
        "category": "moderate",
        "risks": ["extra oil", "sodium from seasoning", "added calories vs plain rice"],
        "pair_with": ["gulay", "sabaw", "water"],
        "better_choice": ["plain boiled rice", "brown rice", "smaller fried rice portion"],
        "score": 5,
        "notes": "Adds extra oil and salt to your carbs. Boiled rice is safer.",
    },
}

# The instructions for the AI on how to behave
YOBAB_SYSTEM_PROMPT = """You are Yobab, the nutrition assistant inside KaonCheck, a Filipino food scanner app.

PERSONALITY:
- Warm, direct, and practical.
- Filipino-aware — you know Filipino dishes, ingredients, and eating habits.
- Slightly funny when it fits, but never cringe or try-hard.
- You are not a comedian. You are not overly medical. Practical first, personality second.
- Use simple English with natural Filipino food words: ulam, kanin, gulay, sabaw, sawsawan, bantayan.

WHAT YOU DO:
- Help users understand their detected meal: nutrition, portions, cooking methods, pairings, health risks, fitness goals, and healthier swaps.
- Give general nutrition guidance only.
- Treat short follow-ups like "why?", "are you sure?", "really?", "what about rice?" as referring to the detected meal and your previous answer.
- Fitness and body goal questions (gym, cutting, bulking, weight loss) are VALID when they relate to the detected meal.

WHAT YOU DO NOT DO:
- Do not diagnose, prescribe medication, or pretend to know exact calories from an image.
- Do not use markdown tables or rigid labels unless specifically asked.
- Do not start by repeating the dish name with an exclamation.
- For serious medical conditions (diabetes management, kidney disease, allergies, eating disorders), give gentle general food guidance and suggest seeing a licensed professional.

STYLE:
- Keep answers to 2-5 sentences usually.
- Sound like a knowledgeable friend, not a report template.
- Do not overclaim exact calorie counts.
- For heavy/fried/salty dishes, suggest gulay, sabaw, water, and modest plain rice — never fried rice or another greasy side.

UNRELATED QUESTIONS:
- If the user asks something clearly unrelated to food, nutrition, health, fitness, or the detected meal, respond with:
  "I'm here for ulam and nutrition questions only. Ask me about this meal, portions, rice, health risks, fitness goals, or healthier swaps."
"""

def normalize_text(text: str) -> str:
    """Clean up text for easier matching."""
    text = text.lower().strip()
    text = re.sub(r"\s+", " ", text)
    return text


def is_short_follow_up(text: str) -> bool:
    """Detect if the user is just asking a quick follow-up question."""
    normalized = normalize_text(text)
    word_count = len(normalized.split())
    if word_count <= 5 and "?" in text:
        return True
    short_patterns = [
        "why", "why not", "how come", "really", "sure", "are you sure",
        "is that true", "confirm", "explain", "explain more", "what do you mean",
        "what about that", "go on", "tell me more", "and then", "so what",
        "how so", "like what", "for real", "seriously", "is it", "can i",
        "what else", "anything else", "ok but", "yes but", "no but",
    ]
    return any(normalized == p or normalized == p + "?" for p in short_patterns)


# Patterns to catch people trying to talk about crypto or coding
_UNRELATED_PATTERNS = [
    r"\b(code|coding|programming|python|javascript|html|css|react)\b",
    r"\b(crypto|bitcoin|ethereum|nft|blockchain)\b",
    r"\b(president|politics|election|senator|government)\b",
    r"\b(essay|homework|assignment|thesis|math problem)\b",
    r"\b(movie|anime|netflix|spotify|tiktok|youtube)\b",
    r"\b(girlfriend|boyfriend|love advice|relationship)\b",
    r"\b(stock market|invest|trading)\b",
    r"\b(weather forecast|temperature today)\b",
    r"\b(translate|translation)\b",
    r"\b(game|gaming|valorant|mobile legends|genshin)\b",
]
_UNRELATED_RE = re.compile("|".join(_UNRELATED_PATTERNS), re.IGNORECASE)


def is_clearly_unrelated(text: str) -> bool:
    """Check if the question is totally off-topic."""
    normalized = normalize_text(text)
    if len(normalized.split()) <= 5:
        return False  # Give short messages the benefit of the doubt
    return bool(_UNRELATED_RE.search(normalized))


# Big list of keywords related to what this app is for
_NUTRITION_TERMS = {
    # food & meals
    "food", "eat", "eating", "meal", "dish", "ulam", "kanin", "gulay", "sabaw",
    "sawsawan", "rice", "meat", "fish", "pork", "chicken", "beef", "egg",
    "vegetable", "fruit", "snack", "breakfast", "lunch", "dinner", "merienda",
    "gravy", "sauce", "skin", "oil", "fried", "grilled", "steamed", "boiled",
    # model-specific dish names
    "adobong", "iga", "inasal", "daing", "bangus", "tilapia", "tulingan",
    "sinaing", "bistek", "lechon", "kawali", "pork chop", "breaded",
    "inihaw", "nilaga", "sinigang", "adobo", "tinola", "lumpia", "sisig",
    "pancit", "caldereta", "pinakbet",
    # nutrition
    "nutrition", "nutrient", "calorie", "calories", "protein", "carb", "carbs",
    "fat", "fiber", "sodium", "salt", "sugar", "cholesterol", "vitamin",
    # health & body
    "health", "healthy", "healthier", "diet", "weight", "lose", "gain",
    "blood pressure", "hypertension", "diabetes", "blood sugar",
    "heart", "kidney", "allergy", "allergic", "uric acid", "gout",
    # fitness & goals
    "gym", "workout", "exercise", "fitness", "cutting", "bulking", "lean",
    "muscle", "body fat", "macro", "macros",
    # portions & frequency
    "portion", "serving", "cup", "how much", "how often", "everyday",
    "every day", "daily", "often", "araw-araw", "pang-araw-araw",
    # cooking & alternatives
    "cook", "cooking", "recipe", "ingredient", "swap", "alternative",
    "better", "version", "pair", "sides", "remove",
    # filipino food words
    "masarap", "maalat", "matamis", "mantika", "matabang", "malusog",
    "kain", "pagkain", "luto", "lutuin", "bantayan",
}


def is_nutrition_intent(text: str) -> bool:
    """Does this message actually sound like it's about food or health?"""
    normalized = normalize_text(text)
    words = set(re.findall(r"[a-z\-]+", normalized))
    if words & _NUTRITION_TERMS:
        return True
    for term in _NUTRITION_TERMS:
        if " " in term and term in normalized:
            return True
    return False


def previous_conversation_was_about_food(messages: list[dict]) -> bool:
    """Checks if we were already talking about food recently."""
    food_signal = re.compile(
        r"(meal|ulam|rice|kanin|gulay|sabaw|sodium|portion|fried|"
        r"grilled|chicken|pork|fish|oil|calorie|protein|health|"
        r"nutrition|diet|vegetable|score|gravy|sawsawan)",
        re.IGNORECASE,
    )
    for msg in reversed(messages[-6:]):
        if msg.get("role") == "assistant" and food_signal.search(msg.get("content", "")):
            return True
    return False


def build_meal_context(meal_data: dict | None) -> str:
    """Preps a summary of the detected dish for the AI's prompt."""
    if not meal_data:
        return "No specific meal detected yet."

    food_name = meal_data.get("food_name", "Unknown dish")
    confidence = meal_data.get("confidence", 0)
    health_score = meal_data.get("health_score", "N/A")
    health_label = meal_data.get("health_label", "")

    lines = [f"Detected food: {food_name}"]
    if confidence:
        lines.append(f"Confidence: {confidence}%")
    if health_score:
        lines.append(f"Health score: {health_score}")
    if health_label:
        lines.append(f"Health label: {health_label}")

    knowledge = FOOD_KNOWLEDGE.get(food_name.lower(), {})
    if knowledge:
        lines.append(f"Category: {knowledge.get('category', 'unknown')}")
        lines.append(f"Risks to watch: {', '.join(knowledge.get('risks', []))}")
        lines.append(f"Pair with: {', '.join(knowledge.get('pair_with', []))}")
        lines.append(f"Better choices: {', '.join(knowledge.get('better_choice', []))}")
        if knowledge.get("notes"):
            lines.append(f"Notes: {knowledge['notes']}")

    advice = meal_data.get("advice", {})
    if advice:
        if advice.get("watch"):
            lines.append(f"Watch: {advice['watch']}")
        if advice.get("pair_with"):
            lines.append(f"Pair with: {advice['pair_with']}")
        if advice.get("better_choice"):
            lines.append(f"Better choice: {advice['better_choice']}")

    return "\n".join(lines)


def get_yobab_reply(
    user_message: str,
    messages: list[dict],
    meal_context: dict | None = None,
) -> str:
    """Entry point for the chatbot logic."""
    normalized = normalize_text(user_message)
    has_food_history = previous_conversation_was_about_food(messages)

    # Let follow-ups through if we've been talking about food
    if is_short_follow_up(normalized) and has_food_history:
        pass
    elif is_clearly_unrelated(user_message):
        return (
            "I'm here for ulam and nutrition questions only. "
            "Ask me about this meal, portions, rice, health risks, "
            "fitness goals, or healthier swaps."
        )
    elif is_nutrition_intent(user_message):
        pass
    elif has_food_history:
        pass
    elif len(normalized.split()) > 6:
        return (
            "I'm here for ulam and nutrition questions only. "
            "Ask me about this meal, portions, rice, health risks, "
            "fitness goals, or healthier swaps."
        )

    context_str = build_meal_context(meal_context)
    prompt_payload = _build_prompt_payload(user_message, messages, context_str)

    # Try AI, fall back to hardcoded if it fails
    ai_reply = call_yobab_ai(prompt_payload)
    if ai_reply:
        return ai_reply

    return _fallback_reply(user_message, messages, meal_context)


def _fallback_reply(
    user_message: str,
    messages: list[dict],
    meal_context: dict | None,
) -> str:
    """The safety net for when the AI is down or offline."""
    normalized = normalize_text(user_message)
    dish = (meal_context or {}).get("food_name", "this dish")
    knowledge = FOOD_KNOWLEDGE.get(dish.lower(), {})

    if any(t in normalized for t in ("are you sure", "sure", "really", "confirm", "is that true")):
        return (
            f"Yes — for general guidance, that advice still fits {dish}. "
            "It's not a ban, just a smarter plate setup. "
            "Pair with gulay or sabaw, keep rice moderate, and drink water."
        )

    if normalized in ("why", "why?", "how come", "explain", "what do you mean"):
        return (
            f"Because {dish} can be heavy on oil, sodium, or fat depending on how it's cooked. "
            "Balancing it with gulay, sabaw, and moderate kanin helps your body handle the meal better."
        )

    if "gravy" in normalized or "sawsawan" in normalized or "sauce" in normalized:
        return (
            f"Gravy and sawsawan add extra sodium and calories on top of {dish}. "
            "Try a squeeze of calamansi instead for a lighter flavor kick."
        )

    if "rice" in normalized or "kanin" in normalized or "cup" in normalized:
        return (
            f"Around 1 cup of plain rice is a good guide with {dish}. "
            "Keeping the carb portion steady helps avoid that heavy food coma feeling."
        )

    if any(t in normalized for t in ("gym", "workout", "cutting", "bulking", "fitness", "muscle", "lean")):
        if knowledge.get("score", 5) >= 7:
            return (
                f"{dish} is a decent choice for active people — it's good protein. "
                "Just pair it with extra gulay for fiber."
            )
        return (
            f"{dish} is okay occasionally, but for gym days you usually want more protein and less oil. "
            "Try a grilled version if you can."
        )

    if any(t in normalized for t in ("hypertension", "blood pressure", "diabetes", "blood sugar", "uric", "gout")):
        return (
            f"If you're watching your health, be extra mindful with {dish}. "
            "Keep the portion small and skip the salty sauces. "
            "Always a good idea to check with your doctor for specific advice."
        )

    if any(t in normalized for t in ("swap", "healthier", "better", "alternative")):
        choices = knowledge.get("better_choice", ["grilled or steamed version"])
        return (
            f"Try {', '.join(choices)} instead. "
            "Tastes great but with less oil and salt."
        )

    if any(t in normalized for t in ("often", "everyday", "every day", "daily", "araw")):
        score = knowledge.get("score", 5)
        if score >= 7:
            return f"{dish} is light enough to have regularly, just don't forget your veggies."
        return (
            f"{dish} is best as an occasional treat, not an everyday thing. "
            "Balance is key."
        )

    if any(t in normalized for t in ("pair", "side", "with", "kasama")):
        pairs = knowledge.get("pair_with", ["gulay", "sabaw", "water", "1 cup rice"])
        return f"Best to pair {dish} with {', '.join(pairs)}. Makes for a much more balanced plate."

    if "skin" in normalized or "remove" in normalized:
        return (
            f"Removing the skin from {dish} cuts out a lot of extra oil and salt. "
            "It's an easy win for your health."
        )

    risks = knowledge.get("risks", ["oil", "sodium", "large portions"])
    pairs = knowledge.get("pair_with", ["gulay", "sabaw", "water", "moderate rice"])
    return (
        f"{dish} can be enjoyed, just watch the {', '.join(risks)}. "
        f"Try pairing it with {', '.join(pairs)}."
    )


def call_yobab_ai(prompt_payload: list[dict]) -> str | None:
    """Talks to the actual AI model (Ollama)."""
    try:
        response = ollama.chat(model=MODEL_NAME, messages=prompt_payload)
        return response["message"]["content"].strip()
    except Exception:
        return None


def call_yobab_ai_stream(prompt_payload: list[dict]):
    """Same as above but streams the response chunk by chunk."""
    try:
        stream = ollama.chat(model=MODEL_NAME, messages=prompt_payload, stream=True)
        for chunk in stream:
            content = chunk.get("message", {}).get("content", "")
            if content:
                yield content
    except Exception:
        return


def _build_prompt_payload(
    user_message: str,
    history: list[dict],
    meal_context_str: str,
) -> list[dict]:
    """Wraps everything up for the AI to understand the current situation."""
    messages = [
        {"role": "system", "content": YOBAB_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"[MEAL CONTEXT]\n{meal_context_str}\n\n"
                "Keep every answer focused on this meal, food, nutrition, "
                "portions, cooking choices, fitness goals, and healthy eating. "
                "Treat short follow-ups as referring to the meal and your previous answer."
            ),
        },
        {
            "role": "assistant",
            "content": "Understood. I'll focus on this meal and nutrition guidance.",
        },
    ]

    for item in history[-MAX_HISTORY_MESSAGES:]:
        role = item.get("role")
        content = str(item.get("content", "")).strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content[:1200]})

    messages.append({"role": "user", "content": user_message})
    return messages


def stream_nutrition_reply(dish_name: str, question: str = "", history_json: str = ""):
    """The main streaming handler for the API."""
    history = _parse_history(history_json)

    meal_context = {
        "food_name": dish_name,
        "confidence": None,
        "health_score": None,
        "health_label": None,
    }

    # If the user didn't ask anything, give them a general summary
    if not question.strip():
        question = (
            f"Give a natural, short advisory for {dish_name}. "
            "Mention what to watch nutritionally, one practical eating tip, "
            "a healthier way to enjoy it, and a simple health score woven into a sentence. "
            "Use simple English with light Filipino food words."
        )

    normalized = normalize_text(question)
    has_food_history = previous_conversation_was_about_food(history)

    is_followup = is_short_follow_up(normalized) and has_food_history
    has_intent = is_nutrition_intent(question)
    is_unrelated = is_clearly_unrelated(question)

    if is_unrelated and not is_followup and not has_intent and not has_food_history:
        fallback = (
            "I'm here for ulam and nutrition questions only. "
            "Ask me about this meal, portions, rice, health risks, "
            "fitness goals, or healthier swaps."
        )
        for word in fallback.split(" "):
            yield word + " "
        return

    context_str = build_meal_context(meal_context)
    prompt_payload = _build_prompt_payload(question, history, context_str)

    streamed_any = False
    for chunk in call_yobab_ai_stream(prompt_payload):
        streamed_any = True
        yield chunk

    if not streamed_any:
        fallback = _fallback_reply(question, history, meal_context)
        for word in fallback.split(" "):
            yield word + " "


def _parse_history(history_json: str) -> list[dict]:
    """Helper to turn the JSON history into a Python list."""
    if not history_json:
        return []
    try:
        raw = json.loads(history_json)
    except json.JSONDecodeError:
        return []
    parsed = []
    for item in raw[-MAX_HISTORY_MESSAGES:]:
        role = item.get("role")
        content = str(item.get("content", "")).strip()
        if role in ("user", "assistant") and content:
            parsed.append({"role": role, "content": content[:1200]})
    return parsed


# Old functions kept so the /analyze endpoint doesn't break
HIGH_RISK_TERMS = ("lechon", "kawali", "sisig", "chicharon", "longganisa", "tocino", "fried")
MODERATE_TERMS = ("rice", "pancit", "adobo", "caldereta", "menudo", "lumpia")
BETTER_TERMS = ("fish", "bangus", "tinola", "sinigang", "vegetable", "pinakbet", "monggo")

def get_quick_advisory(dish_name: str) -> dict:
    """Basic rule-based logic for a fast response."""
    dish = dish_name.lower()
    if any(term in dish for term in HIGH_RISK_TERMS):
        return {
            "Nutritional Profile": f"{dish_name} is satisfying but can be higher in fat, sodium, or calories.",
            "Health Risk": "Large or frequent servings can affect blood pressure, cholesterol, and weight.",
            "Recommendation": "Keep the serving modest and balance with gulay, sabaw, water, and moderate rice.",
            "Healthier Alternative": "Try grilled, baked, air-fried, or less oily version with more vegetables.",
            "Health Score": "5/10",
        }
    if any(term in dish for term in BETTER_TERMS):
        return {
            "Nutritional Profile": f"{dish_name} provides protein and nutrients, especially with vegetables or sabaw.",
            "Health Risk": "Watch added salt, oily preparation, or too much rice on the side.",
            "Recommendation": "A good choice when portion is balanced and salt is controlled.",
            "Healthier Alternative": "Use less salt, add more vegetables, and choose steamed or broth-based preparation.",
            "Health Score": "7/10",
        }
    if any(term in dish for term in MODERATE_TERMS):
        return {
            "Nutritional Profile": f"{dish_name} is filling and energy-dense — depends on ingredients and cooking.",
            "Health Risk": "Too much sauce, fatty meat, or large rice portion can make it heavier than it looks.",
            "Recommendation": "Balance with lean protein, vegetables, and mindful rice portion.",
            "Healthier Alternative": "Choose brown rice, leaner protein, extra vegetables, or a smaller serving.",
            "Health Score": "6/10",
        }
    return {
        "Nutritional Profile": "This dish can fit a balanced diet depending on preparation and portion size.",
        "Health Risk": "Main concern is frequency, portion, and salt/sugar/oil content.",
        "Recommendation": "Balance with vegetables, water, and a sensible portion of rice.",
        "Healthier Alternative": "Choose grilled, steamed, broth-based, or vegetable-rich versions.",
        "Health Score": "6/10",
    }
