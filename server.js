import express from 'express';
import multer from 'multer';
import csv from 'csv-parser';
import createCsvWriter from 'csv-writer';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 16 * 1024 * 1024 } // 16MB limit
});

// OneMap Singapore API endpoints
const ONEMAP_SEARCH_URL = "https://developers.onemap.sg/commonapi/search";

// Carbon emission factor (kg CO2 per km)
const EMISSION_FACTOR_KG_CO2_PER_KM = 0.2;

// Geocode Singapore address using OneMap API
async function geocodeAddress(address) {
  try {
    const params = {
      searchVal: address,
      returnGeom: 'Y',
      getAddrDetails: 'Y'
    };
    
    const response = await axios.get(ONEMAP_SEARCH_URL, { 
      params,
      timeout: 10000 
    });
    
    const data = response.data;
    
    if (data.found > 0 && data.results && data.results.length > 0) {
      const result = data.results[0];
      return {
        lat: parseFloat(result.LATITUDE),
        lng: parseFloat(result.LONGITUDE),
        formatted_address: result.ADDRESS || address
      };
    }
    
    return null;
    
  } catch (error) {
    console.error(`Geocoding error for '${address}':`, error.message);
    return null;
  }
}

// Calculate driving distance using Haversine formula with road factor
function calculateDrivingDistance(startCoords, endCoords) {
  try {
    const { lat: lat1, lng: lng1 } = startCoords;
    const { lat: lat2, lng: lng2 } = endCoords;
    
    // Haversine formula for great circle distance
    const R = 6371; // Earth's radius in kilometers
    
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const deltaLat = (lat2 - lat1) * Math.PI / 180;
    const deltaLng = (lng2 - lng1) * Math.PI / 180;
    
    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
              Math.cos(lat1Rad) * Math.cos(lat2Rad) *
              Math.sin(deltaLng/2) * Math.sin(deltaLng/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const straightDistance = R * c;
    
    // Apply road factor for Singapore (typically 1.2-1.4x straight line)
    const roadDistance = straightDistance * 1.3;
    
    return Math.round(roadDistance * 100) / 100; // Round to 2 decimal places
    
  } catch (error) {
    console.error('Distance calculation error:', error);
    return null;
  }
}

// Process CSV file
async function processCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    const errors = [];
    
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        results.push(data);
      })
      .on('end', async () => {
        try {
          // Find address columns (case insensitive)
          const headers = Object.keys(results[0] || {});
          let startAddressCol = null;
          let endAddressCol = null;
          
          for (const header of headers) {
            const lowerHeader = header.toLowerCase().trim();
            if (lowerHeader.includes('start') && lowerHeader.includes('address')) {
              startAddressCol = header;
            } else if (lowerHeader.includes('end') && lowerHeader.includes('address')) {
              endAddressCol = header;
            }
          }
          
          if (!startAddressCol || !endAddressCol) {
            return reject(new Error("CSV must contain 'Start Address' and 'End Address' columns"));
          }
          
          const processedResults = [];
          let successCount = 0;
          let totalDistance = 0;
          let totalEmissions = 0;
          
          for (let i = 0; i < results.length; i++) {
            const row = results[i];
            const startAddr = String(row[startAddressCol] || '').trim();
            const endAddr = String(row[endAddressCol] || '').trim();
            
            const processedRow = { ...row };
            
            if (!startAddr || !endAddr || startAddr === 'undefined' || endAddr === 'undefined') {
              processedRow.Distance_KM = '';
              processedRow.CO2_Emissions_KG = '';
              processedRow.Calculation_Status = 'Unable to calculate - Missing address';
              processedResults.push(processedRow);
              continue;
            }
            
            try {
              // Geocode start address
              const startCoords = await geocodeAddress(startAddr);
              if (!startCoords) {
                processedRow.Distance_KM = '';
                processedRow.CO2_Emissions_KG = '';
                processedRow.Calculation_Status = 'Unable to calculate - Start address not found';
                processedResults.push(processedRow);
                continue;
              }
              
              // Small delay to respect API limits
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // Geocode end address
              const endCoords = await geocodeAddress(endAddr);
              if (!endCoords) {
                processedRow.Distance_KM = '';
                processedRow.CO2_Emissions_KG = '';
                processedRow.Calculation_Status = 'Unable to calculate - End address not found';
                processedResults.push(processedRow);
                continue;
              }
              
              // Calculate distance
              const distance = calculateDrivingDistance(startCoords, endCoords);
              if (distance === null) {
                processedRow.Distance_KM = '';
                processedRow.CO2_Emissions_KG = '';
                processedRow.Calculation_Status = 'Unable to calculate - Distance calculation failed';
                processedResults.push(processedRow);
                continue;
              }
              
              // Calculate CO2 emissions
              const co2Emissions = Math.round(distance * EMISSION_FACTOR_KG_CO2_PER_KM * 1000) / 1000;
              
              processedRow.Distance_KM = distance;
              processedRow.CO2_Emissions_KG = co2Emissions;
              processedRow.Calculation_Status = 'Success';
              
              successCount++;
              totalDistance += distance;
              totalEmissions += co2Emissions;
              
            } catch (error) {
              processedRow.Distance_KM = '';
              processedRow.CO2_Emissions_KG = '';
              processedRow.Calculation_Status = `Error: ${error.message}`;
            }
            
            processedResults.push(processedRow);
            
            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          resolve({
            data: processedResults,
            stats: {
              totalRecords: results.length,
              successfulCalculations: successCount,
              totalDistance,
              totalEmissions
            },
            message: `Processed ${successCount} out of ${results.length} records successfully`
          });
          
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

// API Routes
app.post('/api/process-csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    
    if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
      return res.status(400).json({ success: false, error: 'Please upload a CSV file' });
    }
    
    const result = await processCsvFile(req.file.path);
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    res.json({ success: true, ...result });
    
  } catch (error) {
    console.error('Error processing CSV:', error);
    
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error processing file' 
    });
  }
});

app.post('/api/download-csv', async (req, res) => {
  try {
    const { data } = req.body;
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: 'No data provided' });
    }
    
    // Create temporary file
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `emissions_calculated_${timestamp}.csv`;
    const filepath = path.join(__dirname, 'temp', filename);
    
    // Ensure temp directory exists
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Get headers from first row
    const headers = Object.keys(data[0]).map(key => ({ id: key, title: key }));
    
    const csvWriter = createCsvWriter.createObjectCsvWriter({
      path: filepath,
      header: headers
    });
    
    await csvWriter.writeRecords(data);
    
    // Send file
    res.download(filepath, filename, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      
      // Clean up temp file
      setTimeout(() => {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
      }, 5000);
    });
    
  } catch (error) {
    console.error('Error creating download:', error);
    res.status(500).json({ error: 'Error creating download file' });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(port, () => {
  console.log(`Singapore Carbon Calculator running on port ${port}`);
});
