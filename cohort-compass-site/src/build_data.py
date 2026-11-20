"""Builds public/data/*.json from the real course/event DB + the fictional community seed.
Usage: python3 build_data.py <courses.json> <events.json> <community.json> <out_dir>"""
import json, sys, re
courses, events, community, out = sys.argv[1:5]
C = json.load(open(courses)); E = json.load(open(events)); M = json.load(open(community))

items = []
for c in C.values():
    items.append({
        "id": c["course_id"], "type": "course", "title": f'{c["course_id"]} {c["title"]}',
        "short": c["title"], "dept": c.get("department") or "", "level": c.get("level") or "",
        "official": {
            "terms": c.get("terms_seen") or [], "prereqs": c.get("prerequisites_official") or "None listed",
            "credits": c.get("credits"), "source": (c.get("provenance") or {}).get("source", "catalog"),
        },
        "tags": c.get("tags") or [],
        "url": "https://catalog.registrar.uiowa.edu/courses",
    })
SLUG = {
    "iclubs": "I-Clubs", "career_connect": "November Career Connect", "mock_interviews": "Mock Interviews",
    "gcs_coaching": "Tippie Graduate Career Services coaching", "knapp": "Knapp Speaker",
    "event_mgmt_cert": "Event Management", "ai_cop": "Applied AI Community",
}
alias = {}
def flat(t):
    if isinstance(t, dict): return sorted({x for v in t.values() for x in (v if isinstance(v, list) else [v])})
    return list(t or [])
for e in E.values():
    sched = e.get("schedule") or {}
    items.append({
        "id": e["id"], "type": e.get("type") or "event", "title": e["title"], "short": e["title"],
        "dept": "Events & resources", "official": {"description": e.get("description") or "", "start": sched.get("start"),
                                                    "where": e.get("location_or_url") or ""},
        "tags": flat(e.get("audience_tags")), "url": e.get("source_url") or (e.get("provenance") or {}).get("source_url"),
    })
    for k, sub in SLUG.items():
        if sub.lower() in e["title"].lower(): alias[k] = e["id"]
# Two real-but-generic items so the model generalizes beyond courses
items.append({"id": "cs_colloquium", "type": "talk series", "title": "Computer Science Colloquium (UIowa CS)", "short": "CS Colloquium",
              "dept": "Computer Science", "official": {"description": "Department talk series where faculty and visiting researchers present their work. Open to all."},
              "tags": ["research", "networking", "computer science"], "url": "https://cs.uiowa.edu"})
items.append({"id": "ug_research", "type": "opportunity", "title": "Undergraduate research assistant position (faculty lab)", "short": "Undergrad RA",
              "dept": "Research", "official": {"description": "Paid or for-credit research positions in faculty labs across campus. Usually found by contacting faculty directly."},
              "tags": ["research", "lab", "undergraduate"], "url": None})
alias["cs_colloquium"] = "cs_colloquium"; alias["ug_research"] = "ug_research"
ids = {i["id"] for i in items}
for t in M["threads"]:
    if t["item"].startswith("@"):
        k = t["item"][1:]
        assert k in alias, ("unresolved", k)
        t["item"] = alias[k]
    assert t["item"] in ids, ("unknown item", t["item"])
json.dump(items, open(f"{out}/items.json", "w"), indent=1)
json.dump({"people": M["people"], "threads": M["threads"]}, open(f"{out}/community.json", "w"), indent=1)
print(len(items), "items;", len(M["threads"]), "threads; aliases", alias)
