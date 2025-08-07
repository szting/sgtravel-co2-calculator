import os
import pandas as pd
import requests
import json
from flask import Flask, render_template, request, send_file, flash, redirect, url_for
from werkzeug.utils import secure_filename
import tempfile
from datetime import datetime
import time

app = Flask(__name__)
app.secret_key = 'your-secret-key-here'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# OneMap Singapore API endpoints
ONEMAP_SEARCH_URL = "https://developers.onemap.sg/commonapi/search"
ONEMAP_ROUTE_URL = "https://developers.onemap.sg/privateapi/routingsvc/route"

# Carbon emission factors (kg CO2 per km)
# Sources: 
# - Singapore's National Environment Agency (NEA)
# - IPCC Guidelines for National Greenhouse Gas Inventories
# - Average for private cars/taxis in Singapore: 0.2 kg CO2/km
EMISSION_FACTOR_KG_CO2_PER_KM = 0.2

def geocode_address(address):
    """Geocode Singapore address using OneMap API"""
    try:
        params = {
            'searchVal': address,
            'returnGeom': 'Y',
            'getAddrDetails': 'Y'
        }
        
        response = requests.get(ONEMAP_SEARCH_URL, params=params, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        
        if data.get('found', 0) > 0 and data.get('results'):
            result = data['results'][0]
            return {
                'lat': float(result['LATITUDE']),
                'lng': float(result['LONGITUDE']),
                'formatted_address': result.get('ADDRESS', address)
            }
        
        return None
        
    except Exception as e:
        print(f"Geocoding error for '{address}': {str(e)}")
        return None

def calculate_driving_distance(start_coords, end_coords):
    """Calculate driving distance using OneMap routing API"""
    try:
        params = {
            'start': f"{start_coords['lat']},{start_coords['lng']}",
            'end': f"{end_coords['lat']},{end_coords['lng']}",
            'routeType': 'drive',
            'token': ''  # OneMap routing requires token, but we'll use alternative approach
        }
        
        # For demo purposes, calculate straight-line distance and apply road factor
        # In production, you'd want to use proper routing API with authentication
        lat1, lng1 = start_coords['lat'], start_coords['lng']
        lat2, lng2 = end_coords['lat'], end_coords['lng']
        
        # Haversine formula for great circle distance
        import math
        
        R = 6371  # Earth's radius in kilometers
        
        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        delta_lat = math.radians(lat2 - lat1)
        delta_lng = math.radians(lng2 - lng1)
        
        a = (math.sin(delta_lat/2) * math.sin(delta_lat/2) + 
             math.cos(lat1_rad) * math.cos(lat2_rad) * 
             math.sin(delta_lng/2) * math.sin(delta_lng/2))
        
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        straight_distance = R * c
        
        # Apply road factor for Singapore (typically 1.2-1.4x straight line)
        road_distance = straight_distance * 1.3
        
        return round(road_distance, 2)
        
    except Exception as e:
        print(f"Distance calculation error: {str(e)}")
        return None

def process_csv_file(file_path):
    """Process uploaded CSV file and calculate distances and emissions"""
    try:
        # Read CSV file
        df = pd.read_csv(file_path)
        
        # Check for required columns (case insensitive)
        df.columns = df.columns.str.strip()
        column_mapping = {}
        
        for col in df.columns:
            col_lower = col.lower()
            if 'start' in col_lower and 'address' in col_lower:
                column_mapping['start_address'] = col
            elif 'end' in col_lower and 'address' in col_lower:
                column_mapping['end_address'] = col
        
        if 'start_address' not in column_mapping or 'end_address' not in column_mapping:
            return None, "CSV must contain 'Start Address' and 'End Address' columns"
        
        # Initialize new columns
        df['Distance_KM'] = None
        df['CO2_Emissions_KG'] = None
        df['Calculation_Status'] = None
        
        total_rows = len(df)
        processed_count = 0
        
        for index, row in df.iterrows():
            start_addr = str(row[column_mapping['start_address']]).strip()
            end_addr = str(row[column_mapping['end_address']]).strip()
            
            if pd.isna(start_addr) or pd.isna(end_addr) or start_addr == 'nan' or end_addr == 'nan':
                df.at[index, 'Calculation_Status'] = 'Unable to calculate - Missing address'
                continue
            
            # Geocode addresses
            start_coords = geocode_address(start_addr)
            if not start_coords:
                df.at[index, 'Calculation_Status'] = 'Unable to calculate - Start address not found'
                continue
            
            # Small delay to respect API limits
            time.sleep(0.1)
            
            end_coords = geocode_address(end_addr)
            if not end_coords:
                df.at[index, 'Calculation_Status'] = 'Unable to calculate - End address not found'
                continue
            
            # Calculate distance
            distance = calculate_driving_distance(start_coords, end_coords)
            if distance is None:
                df.at[index, 'Calculation_Status'] = 'Unable to calculate - Distance calculation failed'
                continue
            
            # Calculate CO2 emissions
            co2_emissions = round(distance * EMISSION_FACTOR_KG_CO2_PER_KM, 3)
            
            # Update dataframe
            df.at[index, 'Distance_KM'] = distance
            df.at[index, 'CO2_Emissions_KG'] = co2_emissions
            df.at[index, 'Calculation_Status'] = 'Success'
            
            processed_count += 1
            
            # Small delay between requests
            time.sleep(0.1)
        
        return df, f"Processed {processed_count} out of {total_rows} records successfully"
        
    except Exception as e:
        return None, f"Error processing CSV: {str(e)}"

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        flash('No file selected')
        return redirect(url_for('index'))
    
    file = request.files['file']
    if file.filename == '':
        flash('No file selected')
        return redirect(url_for('index'))
    
    if file and file.filename.lower().endswith('.csv'):
        filename = secure_filename(file.filename)
        
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.csv', delete=False) as temp_file:
            file.save(temp_file.name)
            temp_input_path = temp_file.name
        
        try:
            # Process the CSV file
            result_df, message = process_csv_file(temp_input_path)
            
            if result_df is None:
                flash(f'Error: {message}')
                return redirect(url_for('index'))
            
            # Save processed file
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_filename = f"emissions_calculated_{timestamp}.csv"
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False, newline='') as temp_output:
                result_df.to_csv(temp_output.name, index=False)
                temp_output_path = temp_output.name
            
            # Clean up input temp file
            os.unlink(temp_input_path)
            
            flash(f'Success: {message}')
            
            return send_file(
                temp_output_path,
                as_attachment=True,
                download_name=output_filename,
                mimetype='text/csv'
            )
            
        except Exception as e:
            flash(f'Error processing file: {str(e)}')
            return redirect(url_for('index'))
    
    else:
        flash('Please upload a CSV file')
        return redirect(url_for('index'))

@app.route('/methodology')
def methodology():
    return render_template('methodology.html')

if __name__ == '__main__':
    app.run(debug=True, port=5000)
