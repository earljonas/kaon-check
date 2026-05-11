import json
import ollama

MODEL_NAME = "llama3.1"
MAX_HISTORY_MESSAGES = 10

SYSTEM_PROMPT = """Ikaw si Nutri, isang friendly at passionate na Filipino nutritionist na nag-aral sa UP Manila at nagtrabaho sa mga ospital sa Maynila bago mag-focus sa community nutrition.

Mahal mo ang pagkain ng mga Pilipino — hindi ka yung tipong nutritionist na sasabihang huwag kumain ng lechon. You know that food is culture, memory, and love. Pero alam mo rin kung paano ibalance ang enjoyment at health.

HOW YOU TALK:
- Natural Taglish — the way real Filipinos actually talk, hindi forced
- Warm, direct, at may konting humor pag appropriate
- Hindi ka nagbibigay ng lecture. You give real talk.
- You say things like "ay", "kasi", "naman", "ha", "diba", "yung ganun", "charot" pag light lang ang usapan
- You sound like a friend who happens to know a lot about nutrition
- Hindi ka robotic. Hindi ka mag-eenumerate ng steps unless tinatanong

WHAT YOU COVER:
- Filipino dishes, nutrition, diet habits, portions, ingredients, cooking methods, general wellness
- If someone asks about symptoms, diagnosis, or serious medical conditions — give general food guidance and gently suggest they see a licensed professional. Hindi ka doctor.
- If someone goes off-topic sa food — redirect them back warmly, hindi parang robot

STYLE RULES:
- 4 to 6 sentences lang usually. Hindi mahabang essay.
- No markdown tables, no rigid labels unless specifically asked
- Don't overclaim exact calories unless given data
- For heavy dishes — suggest vegetables, water, soup, modest rice. Hindi fried rice or another greasy side.
- Sound like you actually care about the person eating, hindi lang about the food"""

SYSTEM_PROMPT = """You are Nutri, a Filipino nutritionist chatbot inside KaonCheck.

You help users understand Filipino food, nutrition, portions, cooking choices, and general health-related eating habits.
You are warm and practical, but you are not a doctor. For symptoms, diagnosis, medication, pregnancy, kidney disease, diabetes management, eating disorders, allergies, or serious medical conditions, give general food guidance and suggest asking a licensed professional.
If the user asks about anything outside food, nutrition, cooking, portions, or health-related eating, politely redirect them back to food and health.

LANGUAGE STYLE:
- Use mostly clear English, around 80-90%.
- Add only light, natural Filipino words when they fit, around 10-20%.
- Safe Filipino words: masarap, konti, gulay, kanin, ulam, maalat, matamis, mantika, sabaw, minsan, araw-araw, ingat.
- Do not force deep Tagalog. If the sentence sounds awkward in Tagalog, write it in English.
- Keep nutrition terms in English: sodium, protein, fiber, saturated fat, blood pressure, cholesterol, calories.
- Avoid fake-sounding jokes, "haha", "charot", exaggerated slang, or awkward lines like "Anong dish ito?"

RESPONSE STYLE:
- Sound like a real nutritionist talking kindly, not a report template.
- Usually write 4 to 6 short sentences.
- No markdown tables.
- Do not use rigid labels like Nutrition, Risk, Recommendation, or Alternative unless asked.
- Do not start by repeating the dish name with an exclamation.
- If giving a health score, weave it naturally into a sentence instead of writing a separate "Health score:" line.
- Do not overclaim exact calories unless data is provided.
- For rich, salty, fatty, or fried dishes, suggest vegetables, water, soup, and modest plain rice; do not suggest fried rice, extra salty condiments, or another greasy side as the healthier pairing."""

DEFAULT_ADVISORY = {
    "Nutritional Profile": "Depende sa luto at portion, pwede itong maging part ng balanced na pagkain.",
    "Health Risk": "Ang pinaka-importante ay yung portion size at kung gaano kadalas mo itong kinakain.",
    "Recommendation": "I-balance mo siya ng gulay, tubig, at tamang dami ng kanin.",
    "Healthier Alternative": "Subukan mo ang grilled, steamed, o yung may mas maraming gulay na version.",
    "Health Score": "6/10",
}

DEFAULT_ADVISORY = {
    "Nutritional Profile": "This dish can fit into a balanced diet depending on preparation and portion size.",
    "Health Risk": "The main concern is how often you eat it, how much you eat, and whether it is high in salt, sugar, or oil.",
    "Recommendation": "Balance it with vegetables, water, and a sensible portion of rice or other carbs.",
    "Healthier Alternative": "Choose grilled, steamed, broth-based, or vegetable-rich versions when possible.",
    "Health Score": "6/10",
}

HIGH_RISK_TERMS = ("lechon", "kawali", "sisig", "chicharon", "longganisa", "tocino", "fried")
MODERATE_TERMS = ("rice", "pancit", "adobo", "caldereta", "menudo", "lumpia")
BETTER_TERMS = ("fish", "bangus", "tinola", "sinigang", "vegetable", "pinakbet", "monggo")


def get_quick_advisory(dish_name: str) -> dict:
    dish = dish_name.lower()
    if any(term in dish for term in HIGH_RISK_TERMS):
        return {
            "Nutritional Profile": f"{dish_name} is usually satisfying and flavorful, but it can be higher in fat, sodium, or calories depending on how it is cooked.",
            "Health Risk": "Large or frequent servings can make it harder to manage blood pressure, cholesterol, and weight goals.",
            "Recommendation": "Keep the serving modest and balance it with vegetables, water, and a reasonable amount of plain rice.",
            "Healthier Alternative": "Try a grilled, baked, air-fried, or less oily version with more vegetables on the side.",
            "Health Score": "5/10",
        }
    if any(term in dish for term in BETTER_TERMS):
        return {
            "Nutritional Profile": f"{dish_name} can provide protein and helpful nutrients, especially when prepared with vegetables or sabaw.",
            "Health Risk": "The main thing to watch is added salt, oily preparation, or eating it with too much rice.",
            "Recommendation": "This can be a good choice when the portion is balanced and the salt is controlled.",
            "Healthier Alternative": "Use less salt, add more vegetables, and choose grilled, steamed, or broth-based preparation when possible.",
            "Health Score": "7/10",
        }
    if any(term in dish for term in MODERATE_TERMS):
        return {
            "Nutritional Profile": f"{dish_name} is filling and energy-dense, so the health impact depends on ingredients, sauce, and portion size.",
            "Health Risk": "Too much refined carbohydrate, fatty meat, or salty sauce can make the meal heavier than it looks.",
            "Recommendation": "Balance it with lean protein, vegetables, and a mindful rice portion.",
            "Healthier Alternative": "Choose brown rice, leaner protein, extra vegetables, or a smaller serving.",
            "Health Score": "6/10",
        }

    advisory = DEFAULT_ADVISORY.copy()

    if any(term in dish for term in HIGH_RISK_TERMS):
        advisory.update({
            "Nutritional Profile": f"Ang {dish_name} ay masarap at filling, pero medyo mataas sa fat, salt, o calories — yung tipong ulam na all-in.",
            "Health Risk": "Pag madalas at malaking serving, pwedeng mag-strain sa puso, blood pressure, at weight mo.",
            "Recommendation": "Gawin mong treat, hindi everyday ulam. Pag kumain ka nito, i-pair mo ng maraming gulay at tubig.",
            "Healthier Alternative": "Try mo yung grilled o air-fried version, o kaya bawasan ang sauce at mantika.",
            "Health Score": "5/10",
        })
    elif any(term in dish for term in BETTER_TERMS):
        advisory.update({
            "Nutritional Profile": f"Ang {dish_name} ay isa sa mas healthy na pagpipilian — may protein at nutrients, lalo na pag may sabaw o gulay.",
            "Health Risk": "Ang usual na problema ay yung sobrang alat ng sauce o pag fried ang preparation. Minsan yung dami ng kanin pa.",
            "Recommendation": "Ituloy mo lang — basta bantayan mo yung salt at i-balance ng gulay.",
            "Healthier Alternative": "Keep it simple — less salt, mas maraming gulay, at grilled o steamed kung pwede.",
            "Health Score": "7/10",
        })
    elif any(term in dish for term in MODERATE_TERMS):
        advisory.update({
            "Nutritional Profile": f"Ang {dish_name} ay filling at energy-dense — depende sa ingredients at kung paano niluto.",
            "Health Risk": "Pag sobra yung sauce, fatty meat, o malaking kanin, medyo heavy na siya sa katawan.",
            "Recommendation": "I-balance mo ng lean protein at gulay, at huwag mag-overdose sa rice.",
            "Healthier Alternative": "Brown rice, mas manipis na karne, dagdag gulay — ganun.",
            "Health Score": "6/10",
        })

    return advisory


def get_health_advisory(dish_name: str) -> dict:
    prompt = f"""Ikaw si Nutri, isang friendly Filipino nutritionist na nagsasalita ng natural Taglish.

Gumawa ka ng maikling health advisory para sa dish na ito: {dish_name}

Sagutin mo sa EXACTLY nitong format, wala nang iba:
Nutritional Profile: [1 sentence in natural Taglish]
Health Risk: [1 sentence in natural Taglish — honest pero hindi pananakot]
Recommendation: [1 practical sentence in Taglish — something they can actually do]
Healthier Alternative: [1 sentence in Taglish — specific, not generic]
Health Score: [number from 1-10]/10
Nutri Says: [2-3 sentences in Taglish — warm, conversational, parang friend mo na nutritionist ang nagsasalita. May personality, hindi boring.]"""

    prompt = f"""You are Nutri, a friendly Filipino nutritionist.
Create a short advisory for this detected dish: {dish_name}

Use mostly clear English with only light Filipino words when natural.
Do not force Tagalog and do not make jokes.

Respond in exactly this format and nothing else:
Nutritional Profile: [1 clear sentence]
Health Risk: [1 honest but calm sentence]
Recommendation: [1 practical sentence]
Healthier Alternative: [1 specific sentence]
Health Score: [number from 1-10]/10
Nutri Says: [2-3 natural sentences, mostly English, like a kind nutritionist talking]"""

    try:
        response = ollama.chat(
            model=MODEL_NAME,
            messages=[{"role": "user", "content": prompt}]
        )
    except Exception:
        return get_quick_advisory(dish_name)

    text = response["message"]["content"]
    result = get_quick_advisory(dish_name)
    for line in text.strip().split("\n"):
        if ":" in line:
            key, value = line.split(":", 1)
            result[key.strip()] = value.strip()

    return result


def stream_nutrition_reply(dish_name: str, question: str = "", history_json: str = ""):
    if _is_out_of_scope(question, dish_name):
        fallback = _fallback_nutri_reply(dish_name, question)
        for word in fallback.split(" "):
            yield word + " "
        return

    topic = question.strip() or (
        f"Mag-start ka ng natural na advisory para sa {dish_name}. "
        "Sabihin mo kung ano yung nutritional value nito, yung dapat bantayan, "
        "isang practical na tip sa pagkain, at isang simpleng health score. "
        "Mag-usap ka parang kausap mo yung friend mo — hindi lecture, real talk lang."
    )

    if not question.strip():
        topic = (
            f"Start with a natural advisory for {dish_name}. "
            "Explain what to watch nutritionally, give one practical eating tip, "
            "suggest one healthier way to enjoy it, and include a simple health score naturally in a sentence. "
            "Use mostly English with only light Filipino words if they sound natural."
        )

    messages = _build_chat_messages(dish_name, topic, history_json)

    try:
        stream = ollama.chat(
            model=MODEL_NAME,
            messages=messages,
            stream=True,
        )
        for chunk in stream:
            content = chunk.get("message", {}).get("content", "")
            if content:
                yield content
    except Exception:
        fallback = _fallback_nutri_reply(dish_name, question)
        for word in fallback.split(" "):
            yield word + " "


def _build_chat_messages(dish_name: str, topic: str, history_json: str) -> list[dict[str, str]]:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Detected dish from the photo: {dish_name}. "
                "Keep every answer focused on food, nutrition, portions, cooking choices, and healthy eating."
            ),
        },
    ]

    for item in _parse_history(history_json):
        messages.append(item)

    messages.append({"role": "user", "content": topic})
    return messages


def _parse_history(history_json: str) -> list[dict[str, str]]:
    if not history_json:
        return []
    try:
        raw_history = json.loads(history_json)
    except json.JSONDecodeError:
        return []

    parsed = []
    for item in raw_history[-MAX_HISTORY_MESSAGES:]:
        role = item.get("role")
        content = str(item.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        parsed.append({"role": role, "content": content[:1200]})
    return parsed


def _is_out_of_scope(question: str, dish_name: str) -> bool:
    ask = question.lower().strip()
    if not ask:
        return False

    food_terms = (
        "food", "eat", "meal", "dish", "nutrition", "nutrient", "healthy", "health", "diet",
        "calorie", "protein", "carb", "fat", "fiber", "rice", "sodium", "salt", "sugar",
        "hypertension", "blood pressure", "diabetes", "cholesterol", "portion", "serving",
        "cook", "fried", "grilled", "ingredient", "healthier", "version", "often", "safe",
        "allergy", "allergic", "weight", "heart", "kidney", "vegetable", "fruit", "meat",
        "fish", "breakfast", "lunch", "dinner", "snack", "pair", "side", "sides", "sauce",
        "ulam", "gulay", "kanin", "masustansya", "matabang", "mapakla", "matamis", "alat",
        "kain", "pagkain", "lutuin", "luto", "healthy", "diet", "sakit", "malusog"
    )
    dish_terms = tuple(part for part in dish_name.lower().replace("-", " ").split() if len(part) > 2)
    return not any(term in ask for term in food_terms + dish_terms)


def _fallback_nutri_reply(dish_name: str, question: str = "") -> str:
    advisory = get_quick_advisory(dish_name)
    score = advisory.get("Health Score", "6/10")
    ask = question.lower()

    if _is_out_of_scope(question, dish_name):
        return (
            "I can help with food and health questions only. "
            f"If you want, ask me how {dish_name} affects blood pressure, portions, sugar, cholesterol, or healthier cooking choices."
        )

    if "hypertension" in ask or "blood pressure" in ask:
        return (
            f"If you have hypertension, be careful with {dish_name}, especially if it is salty, fried, or served with sauce. "
            "The main thing to watch is sodium because it can affect blood pressure. "
            "Keep the portion modest, drink water, and pair it with gulay or soup instead of extra salty sides. "
            "If your doctor gave you a strict sodium limit, treat this as an occasional food, not an araw-araw meal."
        )

    if "healthier" in ask or "version" in ask:
        return (
            f"You can make {dish_name} healthier without removing the comfort-food feeling. "
            "Use less oil, choose leaner protein when possible, and add vegetables for fiber. "
            "Keep the rice portion reasonable so the whole plate does not become too heavy. "
            "That keeps it masarap, but more balanced."
        )

    if "how often" in ask or "gaano kadalas" in ask:
        return (
            f"For {dish_name}, I would use the health score as a guide: around {score}. "
            "If it is high in fat, sodium, or sugar, enjoy it occasionally rather than every day. "
            "What matters most is your overall pattern across the week, not one single meal. "
            "Balance heavier foods with lighter meals, vegetables, and enough water."
        )

    return (
        f"{dish_name} can be enjoyable, but the portion and cooking style matter a lot. "
        f"{advisory['Recommendation']} "
        f"The main thing to watch is this: {advisory['Health Risk']} "
        f"A lighter option would be: {advisory['Healthier Alternative']} "
        f"I would rate it around {score}, so enjoy it with balance, not guilt."
    )

    if _is_out_of_scope(question, dish_name):
        return (
            f"Haha, yun ay medyo labas na sa aking expertise ha. "
            f"Ako si Nutri, kaya food and health lang ang alam ko. "
            f"Kung gusto mo, tanungin mo ako tungkol sa {dish_name} — "
            "like kung pano siya sa blood pressure, gaano kadalas pwedeng kainin, o kung may healthier version ba."
        )

    if "hypertension" in ask or "blood pressure" in ask:
        return (
            f"Para sa may hypertension, kailangan mag-ingat sa {dish_name} — "
            "yung sodium ang pinaka-concern dito, kasama na yung sauces at salty sides. "
            "Pag kumain ka nito, gawin mong maliit lang ang serving, uminom ng maraming tubig, "
            "at i-pair mo ng gulay para may balance. "
            "Kung may strict sodium limit ka galing sa doktor mo, treat lang ito — hindi everyday ulam."
        )

    if "healthier" in ask or "version" in ask:
        return (
            f"Pwede naman gawing mas healthy ang {dish_name} without losing yung Filipino comfort food feeling. "
            "Bawasan ang mantika, pumili ng leaner protein pag pwede, at dagdagan ng gulay para may fiber. "
            "I-keep din ang kanin sa tamang dami para hindi maging too heavy ang buong plate. "
            "Ganun — mula sa occasional treat, maaari siyang maging mas regular na pagkain."
        )

    if "how often" in ask or "gaano kadalas" in ask:
        return (
            f"Para sa {dish_name}, tingnan mo yung health score niya na {score}. "
            "Kung mataas sa fat o salt, gawin mong occasional — hindi linggu-linggo, lalo na hindi araw-araw. "
            "Mas maganda kung i-balance mo ng mas magaan na meals bago at pagkatapos. "
            "Yung pattern mo sa buong linggo ang mas mahalaga kaysa isang kain lang."
        )

    return (
        f"Ay, {dish_name}! Isa yan sa mga classic. "
        f"{advisory['Recommendation']} "
        f"Yung dapat mong bantayan ay ito — {advisory['Health Risk']} "
        f"Kung gusto mo ng mas magaan na version, {advisory['Healthier Alternative']} "
        f"Sa overall, binibigyan ko ito ng {score} — enjoy mo, pero with intention ha."
    )


if __name__ == "__main__":
    result = get_health_advisory("Lechon Kawali")
    for key, value in result.items():
        print(f"{key}: {value}")
