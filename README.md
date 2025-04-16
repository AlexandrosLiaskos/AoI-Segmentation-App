# AoI Segmentation Web Application 

This is a simple web application built with Flask and Mapbox GL JS that allows users to:

1.  Draw an Area of Interest (AoI) boundary using a line tool on an interactive map.
2.  Calculate basic statistics about the drawn AoI (number of points, area if closed, closed status).
3.  Optionally close an open loop drawing.
4.  Configure segmentation parameters (target grid cell area, buffer distance around the AoI).
5.  Segment the (optionally buffered) closed AoI into a grid of rectangular polygons compatible with GEE for further processing.
6.  Visualize the original AoI and the resulting segmentation grid on the map.
7.  Download the segmented grid as a GeoJSON file.

## Features

*   Interactive map interface using Mapbox GL JS.
*   Drawing tools (LineString) provided by Mapbox GL Draw.
*   Backend processing using Flask, Shapely, and Pyproj for geospatial calculations.
*   Calculation of AoI statistics (points, area in km², closed status, centroid).
*   Automatic closing of open LineString drawings.
*   Configurable AoI buffering (in kilometers).
*   Configurable target grid cell area (in square kilometers).
*   Segmentation of the AoI into rectangular grid cells intersecting the (buffered) area.
*   Visualization of original AoI and segmented grid with toggleable visibility.
*   Downloadable GeoJSON output of the segmented grid.
*   Step-by-step UI guidance.

## Screenshot / Demo

![image](https://github.com/user-attachments/assets/48d85f6c-abf0-42b2-b020-21ea5cd37b35)


## Prerequisites

Before you begin, ensure you have met the following requirements:

*   **Python:** Version 3.7 or higher. You can check your version with `python --version`.
*   **pip:** Python's package installer. Usually comes with Python.
*   **Git:** For cloning the repository.
*   **Mapbox Access Token:** You need a free access token from [Mapbox](https://www.mapbox.com/). This is required to display the map tiles and use the drawing tools.

## Setup and Installation

Follow these steps to set up the project locally:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/AlexandrosLiaskos/AoI-Segmentation-App 
    
    cd AoI-Segmentation-App
    ```

2.  **Create and activate a virtual environment (Recommended):**
    *   **Linux/macOS:**
        ```bash
        python3 -m venv venv
        source venv/bin/activate
        ```
    *   **Windows:**
        ```bash
        python -m venv venv
        .\venv\Scripts\activate
        ```

3.  **Install Python dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

## Configuration

The application requires a Mapbox Access Token to function correctly. Set it as an environment variable named `MAPBOX_ACCESS_TOKEN`.

*   **Linux/macOS:**
    ```bash
    export MAPBOX_ACCESS_TOKEN='YOUR_MAPBOX_ACCESS_TOKEN'
    ```
    *(Replace `YOUR_MAPBOX_ACCESS_TOKEN` with your actual token)*

*   **Windows (Command Prompt):**
    ```bash
    set MAPBOX_ACCESS_TOKEN=YOUR_MAPBOX_ACCESS_TOKEN
    ```
    *(Replace `YOUR_MAPBOX_ACCESS_TOKEN` with your actual token)*

*   **Windows (PowerShell):**
    ```bash
    $env:MAPBOX_ACCESS_TOKEN = "YOUR_MAPBOX_ACCESS_TOKEN"
    ```
    *(Replace `YOUR_MAPBOX_ACCESS_TOKEN` with your actual token)*

**Note:** If you don't set the environment variable, the application will use a placeholder token, and the map functionality will likely fail.

## Running the Application

Once the setup and configuration are complete, run the Flask development server:

```bash
flask run
```

Or alternatively:

```bash
python app.py
```

The application will typically be available at `http://127.0.0.1:5000` (or `http://localhost:5000`) in your web browser.

## Usage

1.  Open the application URL in your web browser.
2.  Use the **LineString tool** (top-right corner of the map) to draw the boundary of your Area of Interest. Click to add points, double-click the last point or click the first point to finish the line.
3.  Click the **"Finish Drawing & Calculate Stats"** button in the control panel.
4.  The application will display statistics (Points, Area, Closed status).
    *   If the drawing is an **open loop**, the **"Close AoI Loop"** button will appear (if there are >= 3 points). Click it to connect the start and end points and recalculate stats.
    *   If the drawing is **closed** (or after closing the loop), the segmentation options will appear.
5.  Configure the **"Buffer AoI (km)"** and **"Target Grid Area (km²)"** values as needed.
6.  Click the **"Segment AoI"** button.
7.  The map will display the segmented grid (green polygons) overlaying the original AoI (red line).
8.  Use the checkboxes (**"Show Original AoI"**, **"Show Segmented Grid"**) to toggle layer visibility.
9.  A **download link** for the generated `segmented_aoi_...geojson` file will appear. Click it to save the grid locally.
10. Click **"Restart Drawing"** at any point after finishing the initial drawing to clear the map and start over. Use the trash can icon in the drawing tools to delete the current drawing before finishing.

## File Structure

```
aoi-segmentation-app/
├── static/             # Static files (CSS, JS)
│   ├── css/
│   │   └── style.css   # Custom styles
│   └── js/
│       └── map.js      # Frontend JavaScript logic
├── templates/          # HTML templates
│   └── index.html      # Main application page
├── output/             # Directory for generated GeoJSON files (created automatically)
├── app.py              # Flask application backend logic
├── requirements.txt    # Python package dependencies
└── README.md           # This file
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request or open an Issue.

## License
This project is licensed under the MIT License.
