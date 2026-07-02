You are an expert full-stack developer and AI engineer. I need you to update my existing Bus Tracking System website to include a predictive simulation feature based on historical dummy data. 

Below is the complete Product Requirement Document (PRD) and implementation guide. Read the instructions carefully, especially the strict constraints regarding existing code.

---

# PRD & Implementation Guide: Predictive Bus Tracking Simulation

## 1. Critical Constraints & Safety Guards (Read First)
* **DO NOT TOUCH THE LIVE BUS TEST MODULE:** There is an existing "live bus test" section/code in the repository. Do not modify, delete, or alter this code under any circumstances. 
* **Target Scope:** Your modifications must ONLY apply to the **"Morning to College"** and **"Evening to College"** bus routes. This predictive simulation layer is strictly for these two schedules.

---

## 2. Feature Requirements

### A. Realistic 10-Day Historical Dummy Data (JSON)
* **Requirement:** Create or structure a mock JSON dataset representing 10 days of historical bus runs for both the morning and evening college routes.
* **Realism Factor:** The data *must not* use arbitrary straight-line coordinates. The latitude and longitude coordinates must map to actual, real-world roads connecting the start points to the college. 
* **Data Points Needed per Day:** Timestamp, Latitude, Longitude, Speed, Current Nearest Stop, and Traffic Condition (e.g., Low, Medium, Heavy).

### B. 11th Day Route & Movement Prediction
* **Requirement:** Simulate the "11th Day" run using the 10-day historical baseline.
* **Behavior:** When the simulation runs, the bus marker on the map must move smoothly along the actual road network (utilizing polyline interpolation or snapping to the routing API used in the project, e.g., Leaflet, OpenStreetMap, or Google Maps). 

### C. ETA (Estimated Time of Arrival) Prediction & UI Element
* **UI Update:** Add a dedicated, clearly visible **"ETA" option/display** in the user interface for these routes.
* **Logic:** Calculate the predicted ETA to the next stop and the final destination. This should be calculated dynamically by averaging the historical duration for that specific segment across the 10 days, adjusted slightly if the simulation dictates a traffic variable.

### D. Next Stop Prediction
* **Requirement:** The system must actively analyze the current simulated coordinates against the route profile and display a "Next Stop: [Stop Name]" indicator in the UI.

### E. Search Point Functionality
* **Requirement:** Implement a search bar/point feature allowing users to search for a specific stop or landmark along the route to see when the simulated bus is predicted to reach that exact point.

### F. Geofencing & Deviation Alerts
* **Requirement:** Implement a geofencing check along the simulated route.
* **Behavior:** If the bus coordinate deviates beyond a minor threshold (e.g., 50–100 meters) from the designated "Morning/Evening to College" road path, trigger an immediate UI notification.
* **UI Indication:** Display a clear popup modal or a persistent red warning banner saying: `"Warning: The bus has deviated from the designated route."`

---

## 3. Tech Stack Integration Notes
* **Frontend:** HTML5, CSS3, JavaScript (or specify your framework if using React/Vue).
* **Mapping:** Ensure the map view centers on the active simulated bus and accurately updates the marker position in real-time as the simulation intervals tick.

---

## 4. Expected Output
Please provide:
1. The structured format for the 10-day dummy JSON data.
2. The JavaScript logic/functions required to calculate the 11th-day path, ETA, next stop, and geofence tracking.
3. The UI code snippets (HTML/CSS) for the new ETA display, search bar, and deviation popup.
4. Clear instructions on where to integrate this code into the existing morning/evening route scripts without breaking the live test file.