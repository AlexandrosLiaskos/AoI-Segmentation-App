# ---- File: app.py ----

import os
import json
import math
import uuid
import traceback # Import traceback
from flask import Flask, render_template, request, jsonify, send_from_directory, Response # Added Response
from shapely.geometry import LineString, Polygon, box
from shapely.ops import transform as shapely_transform
import pyproj
import geojson
from functools import partial

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24) # For potential future session use
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'output')

# Ensure output directory exists
os.makedirs(OUTPUT_DIR, exist_ok=True)

# --- Helper Functions ---

def get_utm_crs(lon, lat):
    """Find the UTM CRS based on longitude and latitude."""
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise ValueError("Invalid longitude/latitude for UTM CRS calculation")
    utm_band = str(int(math.floor((lon + 180) / 6) % 60) + 1).zfill(2)
    if lat >= 0:
        epsg_code = '326' + utm_band # Northern Hemisphere
    else:
        epsg_code = '327' + utm_band # Southern Hemisphere
    return pyproj.CRS(f'EPSG:{epsg_code}')

# Removed old transform_geom and transform_geom_back helpers
# We will use pyproj.Transformer directly for clarity

# --- Flask Routes ---

@app.route('/')
def index():
    """Serves the main HTML page."""
    mapbox_token = os.environ.get("MAPBOX_ACCESS_TOKEN", "YOUR_MAPBOX_ACCESS_TOKEN")
    if mapbox_token == "YOUR_MAPBOX_ACCESS_TOKEN":
        print("WARNING: MAPBOX_ACCESS_TOKEN environment variable not set. Using placeholder.")
    return render_template('index.html', mapbox_token=mapbox_token)

# Add route to handle favicon request and avoid 404
@app.route('/favicon.ico')
def favicon():
    return Response(status=204) # Return "No Content"

@app.route('/process_aoi', methods=['POST'])
def process_aoi():
    """Receives drawn LineString GeoJSON, calculates stats."""
    try:
        data = request.get_json()
        if not data:
             app.logger.warning("Received empty JSON data in /process_aoi")
             return jsonify({"error": "Invalid GeoJSON input: No data received"}), 400

        # Allow FeatureCollection or single Feature
        feature = None
        if data.get('type') == 'FeatureCollection':
             if not data.get('features'):
                 app.logger.warning("Received FeatureCollection without features in /process_aoi")
                 return jsonify({"error": "FeatureCollection has no features"}), 400
             feature = data['features'][0]
        elif data.get('type') == 'Feature':
             feature = data
        else:
             app.logger.warning(f"Received invalid GeoJSON type: {data.get('type')} in /process_aoi")
             return jsonify({"error": "Input must be a GeoJSON Feature or FeatureCollection"}), 400

        if not feature or feature.get('geometry', {}).get('type') != 'LineString':
             app.logger.warning(f"Input is not a LineString Feature in /process_aoi. Geometry: {feature.get('geometry', {})}")
             return jsonify({"error": "Input must be a LineString Feature"}), 400

        coords = feature['geometry'].get('coordinates')
        if not coords or len(coords) < 2:
             app.logger.warning(f"LineString has < 2 coordinates in /process_aoi. Coords: {coords}")
             return jsonify({"error": "LineString requires at least 2 points"}), 400

        # --- Geometry processing ---
        line = LineString(coords)
        num_points = len(coords)
        is_closed = coords[0] == coords[-1] if len(coords) > 1 else False # Handle single point case

        area_sqkm = 0
        centroid_coords = {"lon": None, "lat": None}

        if is_closed and len(coords) >= 4: # Valid Polygon check
            try:
                polygon_geom = Polygon(coords)
                if not polygon_geom.is_valid:
                     polygon_geom_fixed = polygon_geom.buffer(0)
                     if not polygon_geom_fixed.is_valid:
                         app.logger.warning("Polygon is invalid and buffer(0) failed to fix it.")
                         raise ValueError("Polygon is invalid and could not be fixed")
                     polygon_geom = polygon_geom_fixed # Use fixed geometry

                centroid = polygon_geom.centroid
                if not centroid.is_empty: # Check centroid is valid
                    centroid_coords = {"lon": centroid.x, "lat": centroid.y}
                    utm_crs = get_utm_crs(centroid.x, centroid.y)
                    transformer_to_utm = pyproj.Transformer.from_crs("EPSG:4326", utm_crs, always_xy=True)
                    polygon_utm = shapely_transform(transformer_to_utm.transform, polygon_geom)
                    area_sqm = polygon_utm.area
                    area_sqkm = round(area_sqm / 1_000_000, 3)
                else:
                    app.logger.warning("Calculated centroid is empty for the polygon.")

            except ValueError as e: # Catch specific errors like invalid UTM zone
                app.logger.error(f"ValueError during area calculation: {e}")
                # Return error to frontend if it's a geometry issue
                return jsonify({"error": f"Geometry processing error: {e}"}), 400
            except Exception as e:
                 # Catch other projection/calculation errors
                 app.logger.error(f"Unexpected error during area calculation: {e}\n{traceback.format_exc()}")
                 # Don't fail the whole request, just report area as 0, but log it
                 area_sqkm = 0 # Reset area on error

        elif not is_closed and len(coords) >= 2: # Use >= 2 for bbox centroid
            try:
                # Calculate centroid of the bounding box for open lines
                bbox = line.bounds # minx, miny, maxx, maxy
                if len(bbox) == 4:
                    centroid_lon = (bbox[0] + bbox[2]) / 2
                    centroid_lat = (bbox[1] + bbox[3]) / 2
                    centroid_coords = {"lon": centroid_lon, "lat": centroid_lat}
                else:
                    app.logger.warning(f"Could not calculate bounding box for LineString. Bounds: {bbox}")
                # app.logger.info("LineString is not closed. Area reported as 0.") # Less verbose logging
            except Exception as e:
                app.logger.error(f"Error calculating bbox centroid for open line: {e}")

        stats = {
            "num_points": num_points,
            "area_sqkm": area_sqkm,
            "is_closed": is_closed,
            "centroid": centroid_coords
        }
        # app.logger.debug(f"Processed AoI stats: {stats}") # Use debug level for verbose success logs
        return jsonify(stats)

    except json.JSONDecodeError as e:
        app.logger.error(f"Failed to decode JSON input in /process_aoi: {e}")
        return jsonify({"error": f"Invalid JSON format: {e}"}), 400
    except Exception as e:
        app.logger.error(f"Unhandled error in /process_aoi: {e}\n{traceback.format_exc()}")
        return jsonify({"error": f"An unexpected server error occurred processing the AoI."}), 500


@app.route('/segment_aoi', methods=['POST'])
def segment_aoi():
    """Segments the AOI based on grid area, potentially applying a buffer."""
    try:
        data = request.get_json()
        if not data:
             app.logger.warning("Received empty JSON data in /segment_aoi")
             return jsonify({"error": "Invalid input: No data received"}), 400

        aoi_geojson = data.get('aoi')
        grid_area_sqkm = data.get('grid_area_sqkm', 20)
        buffer_km = data.get('buffer_km', 0)

        if not aoi_geojson or 'features' not in aoi_geojson or not aoi_geojson['features']:
             app.logger.warning(f"Invalid AoI GeoJSON provided in /segment_aoi: {aoi_geojson}")
             return jsonify({"error": "Invalid AoI GeoJSON provided"}), 400

        feature = aoi_geojson['features'][0]
        if not feature or feature.get('geometry', {}).get('type') != 'LineString':
             app.logger.warning(f"Input for segmentation is not a LineString Feature. Geometry: {feature.get('geometry', {})}")
             return jsonify({"error": "Input for segmentation must be a LineString Feature"}), 400

        coords = feature['geometry'].get('coordinates')
        if not coords or len(coords) < 4 or coords[0] != coords[-1]:
            app.logger.warning(f"Segmentation requires a closed LineString (>=4 points, first==last). Received {len(coords)} points. Closed: {coords[0]==coords[-1] if coords else 'N/A'}.")
            return jsonify({"error": "Segmentation requires a closed LineString (Polygon) with at least 4 points."}), 400

        # --- Geometry processing ---
        aoi_polygon = Polygon(coords)
        if not aoi_polygon.is_valid:
             aoi_polygon_fixed = aoi_polygon.buffer(0)
             if not aoi_polygon_fixed.is_valid or aoi_polygon_fixed.is_empty:
                app.logger.error("Invalid AoI Polygon geometry, buffer(0) failed.")
                return jsonify({"error": "Invalid AoI Polygon geometry (possibly self-intersecting and unfixable)"}), 400
             aoi_polygon = aoi_polygon_fixed
             app.logger.info("Original AoI polygon was invalid, fixed using buffer(0).")


        # Project, buffer, grid generation (keep existing logic, add logging/checks)
        centroid = aoi_polygon.centroid
        if centroid.is_empty:
             app.logger.error("Cannot calculate centroid for segmentation.")
             return jsonify({"error": "Cannot determine center of AoI for projection."}), 400

        utm_crs = get_utm_crs(centroid.x, centroid.y)
        transformer_to_utm = pyproj.Transformer.from_crs("EPSG:4326", utm_crs, always_xy=True)
        transformer_to_wgs84 = pyproj.Transformer.from_crs(utm_crs, "EPSG:4326", always_xy=True)

        aoi_polygon_utm = shapely_transform(transformer_to_utm.transform, aoi_polygon)

        target_area_utm = aoi_polygon_utm
        if buffer_km > 0:
            buffer_m = buffer_km * 1000
            app.logger.info(f"Applying buffer of {buffer_km} km ({buffer_m} m)")
            target_area_utm = aoi_polygon_utm.buffer(buffer_m)
            if not target_area_utm.is_valid or target_area_utm.is_empty:
                 app.logger.error(f"Buffered geometry is invalid or empty after applying {buffer_km}km buffer.")
                 return jsonify({"error": "Buffered geometry is invalid or empty."}), 400

        minx, miny, maxx, maxy = target_area_utm.bounds
        grid_area_sqm = grid_area_sqkm * 1_000_000
        if grid_area_sqm <= 0:
            app.logger.warning(f"Invalid grid area resulting in non-positive sqm: {grid_area_sqm}")
            return jsonify({"error": "Grid area must be positive."}), 400

        side_length_m = math.sqrt(grid_area_sqm)

        grid_cells_utm = []
        x = minx
        cell_count = 0
        while x < maxx:
            y = miny
            while y < maxy:
                cell_utm = box(x, y, x + side_length_m, y + side_length_m)
                # Check intersection before adding
                if cell_utm.intersects(target_area_utm):
                   # Optional: Clip to boundary? For now, keep overlapping squares.
                   # intersection = cell_utm.intersection(target_area_utm)
                   # if not intersection.is_empty: grid_cells_utm.append(intersection)
                   grid_cells_utm.append(cell_utm)
                y += side_length_m
            x += side_length_m
            cell_count +=1
            if cell_count > 10000: # Safety break for huge areas / tiny grids
                 app.logger.warning("Exceeded maximum grid cell limit (10000). Aborting grid generation.")
                 return jsonify({"error": "Grid generation exceeded limits. Try a larger grid size or smaller AoI."}), 400


        grid_cells_wgs84 = []
        skipped_cells = 0
        for i, cell_utm in enumerate(grid_cells_utm):
            if not cell_utm.is_valid:
                cell_utm_fixed = cell_utm.buffer(0)
                if not cell_utm_fixed.is_valid or cell_utm_fixed.is_empty:
                    app.logger.warning(f"Skipping invalid UTM grid cell {i+1} after buffer(0) attempt.")
                    skipped_cells += 1
                    continue
                cell_utm = cell_utm_fixed

            try:
                cell_wgs84 = shapely_transform(transformer_to_wgs84.transform, cell_utm)
                if not cell_wgs84.is_valid or cell_wgs84.is_empty:
                     app.logger.warning(f"Skipping invalid WGS84 grid cell {i+1} after transformation.")
                     skipped_cells += 1
                     continue

                feature = geojson.Feature(
                    geometry=cell_wgs84,
                    properties={"grid_id": i + 1 - skipped_cells} # Adjust ID for skipped cells
                )
                grid_cells_wgs84.append(feature)
            except Exception as transform_err:
                app.logger.error(f"Error transforming grid cell {i+1} to WGS84: {transform_err}")
                skipped_cells += 1


        segmented_geojson = geojson.FeatureCollection(grid_cells_wgs84)
        num_cells = len(grid_cells_wgs84)

        filename = f"segmented_aoi_{uuid.uuid4().hex[:8]}.geojson"
        filepath = os.path.join(OUTPUT_DIR, filename)
        try:
            with open(filepath, 'w') as f:
                geojson.dump(segmented_geojson, f, indent=2)
            app.logger.info(f"Segmented GeoJSON with {num_cells} cells saved to: {filepath}")
        except Exception as write_err:
             app.logger.error(f"Failed to write segmented GeoJSON to file {filepath}: {write_err}")
             # Still return result to frontend, but without filename
             return jsonify({
                "message": f"Segmentation complete ({num_cells} cells). Error saving file.",
                "segmented_geojson": segmented_geojson,
                "filename": None # Indicate file saving failed
             }), 200 # Or maybe 500 if file saving is critical


        return jsonify({
            "message": f"Segmentation complete ({num_cells} cells). {skipped_cells} invalid cells skipped." if skipped_cells else f"Segmentation complete ({num_cells} cells).",
            "segmented_geojson": segmented_geojson,
            "filename": filename
        })

    except json.JSONDecodeError as e:
        app.logger.error(f"Failed to decode JSON input in /segment_aoi: {e}")
        return jsonify({"error": f"Invalid JSON format: {e}"}), 400
    except ValueError as ve: # Catch specific value errors (e.g., invalid UTM zone, negative buffer)
        app.logger.error(f"Value error during segmentation: {ve}")
        return jsonify({"error": f"Invalid input value: {ve}"}), 400
    except Exception as e:
        app.logger.error(f"Unhandled error in /segment_aoi: {e}\n{traceback.format_exc()}")
        return jsonify({"error": f"An unexpected server error occurred during segmentation."}), 500


@app.route('/download/<filename>')
def download_file(filename):
    """Allows downloading of generated files."""
    # Basic security: prevent directory traversal
    if '..' in filename or filename.startswith('/'):
        app.logger.warning(f"Attempted directory traversal in download: {filename}")
        return jsonify({"error": "Invalid filename."}), 400
    try:
        return send_from_directory(OUTPUT_DIR, filename, as_attachment=True)
    except FileNotFoundError:
        app.logger.warning(f"Download request for non-existent file: {filename}")
        return jsonify({"error": "File not found."}), 404
    except Exception as e:
        app.logger.error(f"Error sending file {filename} for download: {e}\n{traceback.format_exc()}")
        return jsonify({"error": "Server error downloading file."}), 500


if __name__ == '__main__':
    # Setup basic logging
    import logging
    logging.basicConfig(level=logging.INFO) # Log INFO and above to console
    # You might want to configure more advanced logging (e.g., to file) in production
    app.run(debug=True) # debug=True provides auto-reload and Werkzeug debugger (HTML tracebacks)
