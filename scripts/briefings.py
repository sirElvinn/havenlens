"""Prepare small, tour-specific CoStar briefings for a private static build."""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

kit = Path(sys.argv[1])
models = set(sys.argv[2:])
if not models:
    raise SystemExit("Supply the kit directory followed by configured Matterport model IDs.")

def records(dataset):
    with (kit / "data" / (dataset + ".jsonl")).open() as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)

def matches(filename, column):
    result = defaultdict(set)
    with (kit / filename).open(newline="") as stream:
        for row in csv.DictReader(stream):
            model = row["MatterportModelId"]
            if model in models:
                result[model].add(int(row[column]))
    return result

commercial = matches("commercial-properties.csv", "PropertyId")
residential = matches("residential-listings.csv", "ListingId")
enums = json.loads((kit / "schemas/enums.json").read_text())
property_ids = {n for group in commercial.values() for n in group}
listing_ids = {n for group in residential.values() for n in group}

def selected(dataset, ids):
    return {r["id"]: r for r in records(dataset) if r["id"] in ids}

properties = selected("commercial-property", property_ids)
homes = {k:v for k,v in selected("residential-listings", listing_ids).items()
         if (v.get("permissionLevels") or {}).get("homes") == 10}
features = selected("residential-listing-features", homes)
related = defaultdict(lambda: defaultdict(set))
tenants = defaultdict(set)
for r in records("commercial-listing-summary"):
    lease = r.get("forLeaseSummary") or {}
    ids = {r.get("propertyId")} | {p.get("id") for p in lease.get("properties") or []} | {s.get("propertyId") for s in lease.get("spaces") or []}
    for pid in ids & property_ids:
        related[pid]["Commercial listings"].add(r["id"])
for r in records("location-occupancy"):
    pid = r.get("propertyId")
    if pid in property_ids:
        related[pid]["Tenancy records"].add(r["id"])
        if r.get("tenantLocationId"):
            tenants[pid].add(r["tenantLocationId"])
company_ids = {r["id"] for r in records("company-detail")}
for pid, ids in tenants.items():
    related[pid]["Linked company locations"] = ids & company_ids
for r in records("commercial-sale-comp"):
    for pid in {e.get("propertyId") for e in r.get("entities") or []} & property_ids:
        related[pid]["Sale records"].add(r["id"])
for r in records("apartment-listing"):
    if r.get("propertyId") in property_ids:
        related[r["propertyId"]]["Apartment listings"].add(r["id"])

points = {}
briefs = {}
for model in sorted(models):
    # An ambiguous model link needs editorial resolution before displaying property facts.
    if len(commercial[model]) + len(residential[model]) != 1:
        continue
    if commercial[model]:
        pid = next(iter(commercial[model]))
        r = properties.get(pid)
        if not r:
            continue
        address = r.get("primaryAddress") or {}
        kind = enums["PropertyType"].get(str(r.get("propertyType")), "Unknown")
        stories = r.get("numStoriesAboveGrade")
        height = r.get("buildingHeightInFeet")
        facts = {"Property type":kind, "Stories above grade":stories, "Building height":f"{height} ft" if height is not None else None}
        counts = {k:len(related[pid][k]) for k in ["Commercial listings","Tenancy records","Linked company locations","Sale records","Apartment listings"]}
        question = f"The property record lists {stories} stories above grade. Which levels can you actually see in this capture?" if stories else "Which spaces are visible, and where does this capture end?"
    else:
        lid = next(iter(residential[model]))
        if lid not in homes:
            continue
        r = homes[lid].get("property") or {}
        address = r.get("address") or {}
        facts = {"Year built":r.get("yearBuilt"), "Bedrooms (minimum)":r.get("bedsMin"), "Full bathrooms":r.get("bathsFull")}
        counts = {"Residential listings":1,"Listing feature sections":len((features.get(lid) or {}).get("sections") or [])}
        question = "Compare the rooms described in the residential listing with what the tour shows. Which details would still need confirmation?"
    if address.get("longitude") is not None and address.get("latitude") is not None:
        points[model] = [address["longitude"], address["latitude"]]
    briefs[model] = {"facts":{k:str(v) if v is not None else "Unreported" for k,v in facts.items()},"records":counts,"question":question}

out = Path("private-data")
out.mkdir(exist_ok=True)
temp = out / "briefings.tmp"
temp.write_text(json.dumps(briefs, indent=2))
temp.replace(out / "briefings.json")
points_temp = out / "parcel-points.tmp"
points_temp.write_text(json.dumps(points))
points_temp.replace(out / "parcel-points.json")
print(f"Prepared {len(briefs)} of {len(models)} tour briefings.")
