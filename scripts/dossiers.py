"""Build HavenLens building risk dossiers from the CoStar offline kit.

Usage (from the app directory):
    python3 -I scripts/dossiers.py /absolute/path/to/kit

Writes public/dossier-data/index.json (one compact row per building, for the map)
and public/dossier-data/b/<shard>.json (full dossiers, 64 shards keyed by id % 64).
Both are git-ignored: the kit is licensed, so keep the output out of public repos.
Contact names, emails and phone numbers are never exported.
"""
import csv
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 -I scripts/dossiers.py /path/to/kit")
kit = Path(sys.argv[1]).expanduser().resolve()
OUT = Path(__file__).resolve().parent.parent / "public" / "dossier-data"
SHARDS = 64
THIS_YEAR = date.today().year

enums = json.loads((kit / "schemas" / "enums.json").read_text())


def name(enum, value, unknown=None):
    label = enums.get(enum, {}).get(str(value))
    if label is None or label in ("Unknown", "PropertyTypeUnknown") or value in (None, 0):
        return unknown
    return label


def pretty(label):
    """'ReinforcedConcrete' -> 'Reinforced concrete'."""
    if not label:
        return label
    label = label.replace("_", " ").replace("  ", " ").strip()
    out = ""
    for i, ch in enumerate(label):
        if ch.isupper() and i and not label[i - 1].isupper() and label[i - 1] != " ":
            out += " " + ch.lower()
        else:
            out += ch.lower() if (ch.isupper() and i and label[i - 1] == " ") else ch
    return out


def records(dataset):
    with (kit / "data" / f"{dataset}.jsonl").open() as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def photo(uri, size="113"):
    return uri.replace("/112/", f"/{size}/") if isinstance(uri, str) else None


# ---------------------------------------------------------------- Matterport links
models = defaultdict(list)
with (kit / "commercial-properties.csv").open(newline="") as stream:
    for row in csv.DictReader(stream):
        if row["MatterportModelId"]:
            models[int(row["PropertyId"])].append(row["MatterportModelId"])

# ---------------------------------------------------------------- Properties
properties = {r["id"]: r for r in records("commercial-property")}
floor_names = {}  # propertyFloorId -> label
for pid, r in properties.items():
    for fl in r.get("floors") or []:
        floor_names[fl.get("propertyFloorId")] = pretty(name("FloorName", fl.get("floorName"), "Unlabeled floor"))

# ---------------------------------------------------------------- Tenancies
companies = {}
for c in records("company-detail"):
    profile = c.get("profile") or {}
    companies[c["id"]] = {
        "name": c.get("name"),
        "employees": c.get("numEmployees"),
        "industry": pretty(name("IndustryType", profile.get("industryType"))),
    }

current = defaultdict(list)
history = defaultdict(int)
for o in records("location-occupancy"):
    pid = o.get("propertyId")
    history[pid] += 1
    if o.get("toDate") is not None:
        continue
    company = companies.get(o.get("tenantLocationId")) or {}
    spaces = o.get("spaces") or []
    current[pid].append({
        "name": company.get("name") or "Unidentified tenant",
        "industry": company.get("industry") or pretty(name("IndustryType", o.get("industryType"))),
        "employees": company.get("employees"),
        "sqft": round(sum(s.get("squareFeetOccupied") or 0 for s in spaces)) or None,
        "floors": sorted({floor_names.get(s.get("propertyFloorId"), "Unlabeled floor") for s in spaces if s.get("propertyFloorId")}),
        "since": (o.get("moveInDate") or o.get("fromDate") or "")[:4] or None,
    })

# ---------------------------------------------------------------- Sales and listings
sales = defaultdict(list)
for s in records("commercial-sale-comp"):
    for pid in {e.get("propertyId") for e in s.get("entities") or []}:
        if pid in properties:
            sales[pid].append({
                "date": (s.get("soldDate") or "")[:10] or None,
                "price": s.get("soldForPrice") if s.get("salePriceStatus") != 0 else s.get("soldForPrice"),
                "portfolio": len(s.get("entities") or []) > 1,
            })

listings = defaultdict(lambda: {"active": 0, "availableSqft": 0})
for l in records("commercial-listing-summary"):
    pid = l.get("propertyId")
    if pid in properties and l.get("listingStatus") == 1:
        listings[pid]["active"] += 1
        listings[pid]["availableSqft"] += round((l.get("forLeaseSummary") or {}).get("totalAvailableSquareFeet") or 0)

apartment_listing = {}
for a in records("apartment-listing"):
    apartment_listing[a.get("propertyId")] = a

# ---------------------------------------------------------------- Scoring
# Design occupant-load factors (sq ft gross per person), after IBC Table 1004.5.
LOAD_FACTOR = {"Office": 150, "Healthcare": 150, "Flex": 150, "Industrial": 300, "General retail": 60,
               "Mixed use": 100, "Specialty": 150, "Sports and entertainment": 30}
PERSONS_PER_UNIT = 2.5  # average US household size
PERSONS_PER_ROOM = 2.0  # full hotel occupancy assumption


def elevator_count(r):
    total = 0
    sources = [(r.get("propertyApartment") or {}).get("elevators") or []]
    for block in ("propertyOffice", "propertyIndustrial", "propertyRetail", "propertyFlex", "propertyHospitality"):
        sources.append(((r.get(block) or {}).get("structural") or {}).get("elevators") or [])
    for lst in sources:
        for e in lst:
            if e.get("elevatorType") in (1, 2):  # passenger, freight
                total += e.get("numElevators") or 0
    return total or None


# Floor-name codes (FloorName enum) that sit below grade, and structured-parking levels.
BELOW_GRADE = {16, 17, 18, 19, 20}  # Subway, Metro, LowerLevel, Concourse, Basement
PARKING = set(range(5, 15))          # ParkingLevelTen .. ParkingLevelOne


def build(pid, r):
    floor_codes = {f.get("floorName") for f in r.get("floors") or []}
    addr = r.get("primaryAddress") or {}
    kind = pretty(name("PropertyType", r.get("propertyType"), "Unknown"))
    apt = r.get("propertyApartment") or {}
    hotel = r.get("propertyHospitality") or {}
    stories = r.get("numStoriesAboveGrade")
    height = r.get("buildingHeightInFeet")
    gba = r.get("grossBuildingAreaSquareFeet")
    material = pretty(name("BuildingConstructionMaterialType", r.get("buildingConstructionMaterial")))
    sprinkler_type = name("SprinklerType", r.get("sprinklerType"))
    sprinklers = r.get("hasSprinklers")
    if sprinklers is None and sprinkler_type:
        sprinklers = True
    events = r.get("constructionEvents") or []
    built = min((e["year"] for e in events if e.get("eventType") == 2 and e.get("year")), default=None)
    renovated = max((e["year"] for e in events if e.get("eventType") in (4, 16, 17) and e.get("year")), default=None)
    lifestyle = name("ApartmentLifestyleType", apt.get("apartmentLifestyleType"))
    units = apt.get("totalNumUnits")
    rooms = hotel.get("numUnits") or hotel.get("rooms") if isinstance(hotel.get("numUnits") or hotel.get("rooms"), int) else hotel.get("numUnits")
    tenants = sorted(current.get(pid, []), key=lambda t: (t["sqft"] or 0), reverse=True)
    headcount = sum(t["employees"] or 0 for t in tenants)
    headcount_known = sum(1 for t in tenants if t["employees"])

    # People estimate. "peak" is the busiest hour; the client scales it by an hourly
    # occupancy curve for the building's class (residential peaks at night, offices by day).
    sleeping = bool(apt) or bool(hotel) or kind in ("Multifamily", "Hospitality")
    vacancy = (apt.get("vacancyPercent") or 7) / 100
    design = round(gba / LOAD_FACTOR[kind]) if gba and kind in LOAD_FACTOR else None
    if units:
        klass = "residential"
        people = round(units * PERSONS_PER_UNIT * (1 - vacancy))
        basis = f"{units:,} units × {PERSONS_PER_UNIT} residents, less {round(vacancy*100)}% vacancy"
    elif isinstance(rooms, int) and rooms:
        klass = "hotel"
        people = round(rooms * PERSONS_PER_ROOM * 0.7)
        basis = f"{rooms:,} rooms × {PERSONS_PER_ROOM:g} guests at 70% occupancy"
    else:
        klass = {"General retail": "retail", "Industrial": "industrial", "Healthcare": "healthcare",
                 "Sports and entertainment": "retail"}.get(kind, "office")
        if headcount:
            people = headcount
            basis = f"recorded headcount of {headcount_known} of {len(tenants)} current tenants"
        elif design:
            people = round(design * 0.35)
            basis = f"35% of design occupant load ({round(gba):,} sq ft ÷ {LOAD_FACTOR[kind]} sq ft per person)"
        else:
            people, basis = None, None

    # Transparent pre-plan priority score.
    factors = []

    def add(points, label, detail, kind_="risk"):
        factors.append({"points": points, "label": label, "detail": detail, "kind": kind_})

    if (height and height >= 75) or (stories and stories >= 7):
        add(25, "High-rise", f"{stories or '?'} stories" + (f", {round(height)} ft" if height else "") + ": beyond typical aerial ladder reach (75 ft)")
    elif stories and stories >= 4:
        add(12, "Mid-rise", f"{stories} stories: interior attack and standpipe likely")
    if sprinklers is False:
        add(20, "No sprinklers recorded", "The record states the building is not sprinklered")
    elif sprinklers is None:
        add(10, "Sprinkler status unknown", "Not recorded in the CoStar kit: verify on site", "gap")
    if material == "Wood frame":
        add(12, "Wood-frame construction", "Combustible structure: faster fire spread and earlier collapse risk")
    elif not material:
        add(4, "Construction type unknown", "Not recorded in the CoStar kit", "gap")
    if built and built < 1975:
        add(10, f"Built {built}", "Predates modern fire and life-safety codes")
    elif not built:
        add(3, "Year built unknown", "Not recorded", "gap")
    # Sleeping occupancy is scored in the app, scaled by the hour and the building's size.
    if lifestyle in ("Senior",):
        add(15, "Senior housing", "Occupants may need assisted evacuation")
    if kind == "Healthcare":
        add(15, "Healthcare occupancy", "Patients may be non-ambulatory")
    if people and people >= 1000:
        add(12, "Large population", f"About {people:,} people at the busiest hour")
    elif people and people >= 250:
        add(6, "Sizable population", f"About {people:,} people at the busiest hour")
    if apt.get("isWalkup") and stories and stories >= 3:
        add(5, "Walk-up", "No elevator: stairs are the only vertical route")

    score = min(100, sum(f["points"] for f in factors))
    known = [stories is not None, height is not None, sprinklers is not None, material is not None, built is not None, people is not None]
    confidence = round(100 * sum(known) / len(known))

    floors = []
    per_floor = defaultdict(lambda: {"tenants": 0, "occupiedSqft": 0, "employees": 0})
    for t in tenants:
        for fl in t["floors"]:
            per_floor[fl]["tenants"] += 1
            per_floor[fl]["occupiedSqft"] += (t["sqft"] or 0) // max(1, len(t["floors"]))
            per_floor[fl]["employees"] += (t["employees"] or 0) // max(1, len(t["floors"]))
    seen = set()
    for fl in sorted(r.get("floors") or [], key=lambda f: f.get("floorName") or 0, reverse=True):
        label = floor_names.get(fl.get("propertyFloorId"))
        if label in seen or label in ("Unknown floor", "Unlabeled floor", None):
            continue
        seen.add(label)
        floors.append({"name": label, "sqft": round((fl.get("floorSize") or {}).get("squareFeet") or 0) or None, **per_floor.get(label, {"tenants": 0, "occupiedSqft": 0, "employees": 0})})

    pets = sorted({pretty(name("PetType", p.get("petType"))) for p in (apt.get("residentialProfile") or {}).get("petPolicies") or [] if name("PetType", p.get("petType"))})
    photos = [photo(a.get("attachmentUri")) for a in [r.get("primaryPhoto") or {}] + (r.get("attachments") or [])
              if a.get("attachmentUri") and a.get("attachmentType") in (3, 4, 1, 6, 33, 132)]
    photos = list(dict.fromkeys(p for p in photos if p))[:8]
    sale_list = sorted(sales.get(pid, []), key=lambda s: s["date"] or "", reverse=True)
    al = apartment_listing.get(pid) or {}

    street = " ".join(str(x) for x in [addr.get("streetNumber"), addr.get("streetName"), addr.get("streetType")] if x)
    tier = "High" if score >= 55 else "Elevated" if score >= 35 else "Standard"
    row = {
        "id": pid,
        "name": r.get("buildingName") or street or f"Property {pid}",
        "street": street,
        "city": addr.get("city"),
        "state": addr.get("state"),
        "zip": (addr.get("postcode") or "")[:5] or None,
        "lat": addr.get("latitude"),
        "lon": addr.get("longitude"),
        "type": kind,
        "stories": stories,
        "score": score,
        "tier": tier,
        "people": people,
        "class": klass,
        "sprinklers": sprinklers,
        "tour": bool(models.get(pid)),
        "elev": elevator_count(r),
        "heightFt": round(height) if height else None,
        "style": pretty(name("ApartmentStyleType", apt.get("apartmentStyleType"))),
        # Short hazard flags for incident triage on the map.
        "flags": [f for f, on in [
            ("highrise", bool((height and height >= 75) or (stories and stories >= 7))),
            ("nosprinklers", sprinklers is False),
            ("woodframe", material == "Wood frame"),
            ("senior", lifestyle == "Senior"),
            ("healthcare", kind == "Healthcare"),
            ("walkup", bool(apt.get("isWalkup")) and bool(stories and stories >= 3)),
            ("old", bool(built and built < 1975)),
            ("belowgrade", bool(floor_codes & BELOW_GRADE)),
            ("parking", bool(floor_codes & PARKING)),
        ] if on],
    }
    detail = {
        **row,
        "subtype": pretty(name("PropertySubtype", r.get("propertySubtype"))),
        "heightFeet": height,
        "grossSqft": round(gba) if gba else None,
        "typicalFloorSqft": round(r["grossTypicalFloorSquareFeet"]) if r.get("grossTypicalFloorSquareFeet") else None,
        "lotAcres": r.get("lotSize") if r.get("lotSizeMeasurementType") == 2 else None,
        "material": material,
        "sprinklerType": sprinkler_type,
        "built": built,
        "renovated": renovated,
        "buildingClass": name("BuildingClass", r.get("buildingClass")),
        "elevators": elevator_count(r),
        "parkingSpaces": sum(p.get("totalSpaces") or 0 for p in r.get("parking") or []) or None,
        "peopleBasis": basis,
        "designLoad": design,
        "factors": factors,
        "confidence": confidence,
        "floors": floors,
        "floorRecordsNote": "Floor records can include removed floors and are not a verified stack.",
        "tenants": tenants[:15],
        "tenantCount": len(tenants),
        "tenancyHistory": history.get(pid, 0),
        "headcount": headcount or None,
        "apartment": apt and {
            "units": units,
            "buildings": apt.get("numBuildings"),
            "style": pretty(name("ApartmentStyleType", apt.get("apartmentStyleType"))),
            "lifestyle": lifestyle,
            "vacancyPercent": apt.get("vacancyPercent"),
            "walkup": apt.get("isWalkup"),
            "affordableUnits": apt.get("affordableUnits"),
            "pets": pets,
            "unitsAvailable": al.get("unitsAvailable") if isinstance(al.get("unitsAvailable"), int) else None,
        } or None,
        "hotel": hotel and {"rooms": rooms, "brand": hotel.get("hotelBrandName"), "pools": hotel.get("numSwimmingPools")} or None,
        "sales": sale_list[:5],
        "saleCount": len(sale_list),
        "listings": listings.get(pid) if pid in listings else None,
        "photos": photos,
        "models": models.get(pid, [])[:12],
        "modelCount": len(models.get(pid, [])),
    }
    return row, detail


index, shards = [], defaultdict(dict)
for pid, r in properties.items():
    row, detail = build(pid, r)
    if row["lat"] is None or row["lon"] is None:
        continue
    index.append(row)
    shards[pid % SHARDS][pid] = detail

index.sort(key=lambda r: -r["score"])
(OUT / "b").mkdir(parents=True, exist_ok=True)
compact = dict(separators=(",", ":"), ensure_ascii=False)
(OUT / "index.json").write_text(json.dumps({"generated": date.today().isoformat(), "buildings": index}, **compact))
for shard, data in shards.items():
    (OUT / "b" / f"{shard}.json").write_text(json.dumps(data, **compact))
tiers = defaultdict(int)
for r in index:
    tiers[r["tier"]] += 1
print(f"Wrote {len(index)} dossiers to {OUT} ({dict(tiers)}).")
