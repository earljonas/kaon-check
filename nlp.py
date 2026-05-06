import ollama

def get_health_advisory(dish_name: str) -> dict:
    prompt = f"""You are a dietary health advisor specializing in Filipino food.
Provide a structured health advisory for the Filipino dish: {dish_name}

Respond in exactly this format, nothing else:
Nutritional Profile: [1 sentence]
Health Risk: [1 sentence]
Recommendation: [1 sentence]
Healthier Alternative: [1 sentence]
Health Score: [number from 1-10]/10"""

    response = ollama.chat(
        model="gemma3:1b",
        messages=[{"role": "user", "content": prompt}]
    )

    text = response["message"]["content"]
    result = {}
    for line in text.strip().split("\n"):
        if ":" in line:
            key, value = line.split(":", 1)
            result[key.strip()] = value.strip()

    return result

if __name__ == "__main__":
    result = get_health_advisory("Lechon Kawali")
    for key, value in result.items():
        print(f"{key}: {value}")