"""Canonical identities and qualitative preparation notes for the 11 trained dishes.

These are application heuristics, not nutrient measurements or clinical ratings.
"""
import re

DISHES = {'adobong iga': {'name': 'Adobong Iga',
                 'risks': ['sodium from soy sauce', 'fat from iga (rib) cuts'],
                 'pair_with': ['gulay', 'sabaw', 'water', '1 cup rice'],
                 'better_choice': ['chicken adobo with breast meat', 'less soy sauce version']},
 'chicken inasal': {'name': 'Chicken Inasal',
                    'risks': ['oil from basting', 'sodium from marinade'],
                    'pair_with': ['gulay', 'sabaw', 'water', '1 cup rice'],
                    'better_choice': ['inasal with less oil basting', 'remove skin before eating']},
 'fried chicken': {'name': 'Fried Chicken',
                   'risks': ['oil from deep frying', 'sodium', 'large portions'],
                   'pair_with': ['gulay', 'sabaw', 'water', '1 cup rice'],
                   'better_choice': ['inihaw na manok',
                                     'tinola',
                                     'air-fried chicken',
                                     'chicken inasal']},
 'daing na bangus': {'name': 'Daing na Bangus',
                     'risks': ['oil from frying', 'sodium from salt curing'],
                     'pair_with': ['gulay', 'sabaw', 'vinegar dip', '1 cup rice'],
                     'better_choice': ['grilled bangus', 'inihaw na bangus', 'sinigang na bangus']},
 'pan fried tilapia': {'name': 'Pan Fried Tilapia',
                       'risks': ['oil from pan frying', 'sodium from seasoning'],
                       'pair_with': ['gulay', 'sabaw', 'water', '1 cup rice'],
                       'better_choice': ['steamed tilapia',
                                         'sinigang na tilapia',
                                         'grilled tilapia']},
 'sinaing na tulingan': {'name': 'Sinaing na Tulingan',
                         'risks': ['sodium from salt', 'slight bitterness if overcooked'],
                         'pair_with': ['gulay', 'moderate rice', 'water'],
                         'better_choice': ['sinaing with less salt and more kamias']},
 'breaded pork chop': {'name': 'Breaded Pork Chop',
                       'risks': ['oil from frying', 'sodium', 'breading adds carbs and calories'],
                       'pair_with': ['gulay', 'sabaw', 'water', '1 cup rice'],
                       'better_choice': ['grilled pork chop', 'baked pork chop without breading']},
 'lechon kawali': {'name': 'Lechon Kawali',
                   'risks': ['saturated fat', 'sodium', 'cholesterol', 'deep-fried pork belly'],
                   'pair_with': ['atchara', 'gulay', 'water', 'small rice'],
                   'better_choice': ['grilled liempo',
                                     'inihaw na baboy',
                                     'lechon manok (roasted)']},
 'pork bistek': {'name': 'Pork Bistek',
                 'risks': ['sodium from soy sauce and calamansi marinade', 'fat from pork cut'],
                 'pair_with': ['gulay', 'sabaw', 'water', '1 cup rice'],
                 'better_choice': ['bistek with leaner pork or chicken', 'less soy sauce']},
 'boiled rice': {'name': 'Boiled Rice',
                 'risks': ['refined carbs if white rice', 'large portions spike blood sugar'],
                 'pair_with': ['any ulam', 'gulay', 'sabaw'],
                 'better_choice': ['brown rice', 'half-cup portion', 'cauliflower rice']},
 'fried rice': {'name': 'Fried Rice',
                'risks': ['extra oil', 'sodium from seasoning', 'added calories vs plain rice'],
                'pair_with': ['gulay', 'sabaw', 'water'],
                'better_choice': ['plain boiled rice', 'brown rice', 'smaller fried rice portion']}}


def canonical_food_name(label: str) -> str:
    match = re.search(r"-\s*([^-]+?)\s*-", label)
    name = (match.group(1) if match else label).strip().casefold()
    if name not in DISHES:
        raise ValueError("Unsupported dish")
    return DISHES[name]["name"]


def preparation_notes(dish_name: str) -> dict:
    knowledge = DISHES[canonical_food_name(dish_name).lower()]
    return {
        "Health Risk": ", ".join(knowledge["risks"]),
        "Recommendation": ", ".join(knowledge["pair_with"]),
        "Healthier Alternative": ", ".join(knowledge["better_choice"]),
        "basis": "Rule-based preparation notes; not a clinical assessment",
    }
