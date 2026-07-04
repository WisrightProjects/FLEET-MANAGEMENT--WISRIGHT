# Product Requirements Document (PRD)

## Project

**Bus Tracking & Fleet Management System**

## Objective

Enhance the existing Bus Tracking System by adding realistic dummy historical data, multiple bus routes, live map simulation, and predictive analytics using historical data. The implementation must not modify the existing testing environment or prototype pages.

---

# Important Constraints

## DO NOT MODIFY

The following must remain completely untouched:

* Bus Test subdomain
* Bus Test frontend
* Bus Test backend
* Any APIs or services connected to the Bus Test environment
* Existing prototype/testing logic

This environment is strictly reserved for testing purposes.

---

## Existing Bus

There is already an existing bus (Bus 1 / S Bus).

**Do NOT modify it.**

* Do not change its route
* Do not change its data
* Do not replace its GPS
* Do not alter its behavior

Leave it exactly as it is.

---

# Homepage Changes

The homepage currently contains:

* Morning → College buses
* Evening → Return buses

Enhance this page only.

---

# Morning Schedule

Keep the existing S Bus unchanged.

Add **5 additional buses** with realistic dummy routes.

Example:

* Bus A
* Bus B
* Bus C
* Bus D
* Bus E

Each bus should have:

* Unique route
* Unique driver name
* Bus number
* Latitude
* Longitude
* Current speed
* Distance travelled
* ETA
* Status
* Live map marker

---

# Evening Schedule

Similarly,

Keep the existing S Bus unchanged.

Add another **5 evening buses**.

Each should have different return routes.

---

# Route Requirements

Use realistic Chennai suburban routes.

Example locations:

* Mogappair
* Ambattur
* Avadi
* Anna Nagar
* Poonamallee
* Porur
* Koyambedu
* Tambaram
* Velachery
* Medavakkam
* Sholinganallur
* Thiruvanmiyur
* Red Hills
* Madhavaram
* Perungalathur

Each bus should have its own unique route.

Example:

Bus A

Mogappair
→ Anna Nagar
→ Koyambedu
→ College

Bus B

Avadi
→ Ambattur
→ Padi
→ College

Bus C

Tambaram
→ Chromepet
→ Guindy
→ College

etc.

---

# Live GPS Simulation

Each bus should continuously display simulated:

* Latitude
* Longitude
* Speed
* Distance
* Heading
* Last updated time

Generate realistic GPS movement.

Example:

Latitude:
13.0823

Longitude:
80.1789

Speed:
42 km/h

Distance:
12.6 km

Update automatically using dummy data.

---

# Map

The map must display

* Current bus location
* Route polyline
* Moving marker
* ETA
* Destination

The marker should move according to dummy GPS coordinates.

---

# Historical Dataset

Create dummy historical data.

Instead of showing only the current week, include at least the previous **15 days**.

Example

18 June

19 June

20 June

...

30 June

1 July

2 July

3 July

4 July

etc.

Every day should contain data for every dummy bus.

Each record should include:

* Date
* Bus Number
* Route
* Latitude
* Longitude
* Speed
* Distance
* ETA
* Arrival Time
* Departure Time
* Delay
* Status

---

# Weekly View

The homepage calendar should display previous records properly.

For example

Previous 15 days

↓

28 June

29 June

30 June

1 July

2 July

3 July

4 July

...

Each date should allow viewing that day's dummy bus data.

---

# Prediction Feature

Remove the existing standalone Prediction page/feature.

Instead,

Integrate prediction inside the Morning and Evening Bus pages.

---

# Prediction Logic

Using the previous 15 days of dummy historical data,

predict the next **5–10 days**.

Prediction should estimate:

* Expected departure time
* Expected arrival time
* ETA
* Travel duration
* Average speed
* Delay probability
* Expected distance
* Route confidence

Use simple statistical or rule-based prediction based on dummy historical patterns.

No complex ML model is required.

Predictions only need to appear realistic.

---

# Prediction Display

Each bus should display

Historical Trend

↓

Predicted Next 5–10 Days

Example

Date

Predicted ETA

Predicted Arrival

Expected Delay

Confidence

5 July

8:32 AM

9:11 AM

2 mins

96%

6 July

8:31 AM

9:10 AM

1 min

95%

...

---

# Dummy Data Quality

Generate realistic values.

Examples:

Speed

25–60 km/h

ETA

15–60 minutes

Delay

0–10 minutes

Distance

10–35 km

Latitude/Longitude should follow actual Chennai roads.

---

# Backend Requirements

Create structured dummy JSON/database records.

Suggested fields:

* busId
* busNumber
* routeName
* driver
* date
* timestamp
* latitude
* longitude
* speed
* distance
* eta
* delay
* arrivalTime
* departureTime
* status

Generate sufficient historical records for all buses across the previous 15 days and predicted records for the next 5–10 days.

---

# Frontend Requirements

Update only the production Bus Tracking pages.

The UI should support:

* Live map
* Multiple buses
* Historical records
* Date selection
* Prediction table
* ETA cards
* Bus status
* GPS details

Maintain the existing design language.

---

# UI/UX

The UI should appear like a professional fleet management dashboard.

Include:

* Bus cards
* Live status
* Route map
* Prediction cards
* Historical data table
* Search/filter by bus
* Date selector
* Responsive layout

---

# Success Criteria

The project will be considered complete when:

* Existing S Bus remains untouched.
* Bus Test subdomain remains untouched.
* Five additional morning buses are added.
* Five additional evening buses are added.
* Every bus has realistic dummy GPS movement.
* The map updates correctly with bus locations.
* Previous 15 days of dummy history are available.
* Next 5–10 days of predictions are generated from historical dummy data.
* Prediction is integrated into the Morning and Evening bus sections instead of a separate Prediction page.
* All changes are isolated to the production Bus Tracking System only.
