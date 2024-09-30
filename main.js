import Map from 'ol/Map.js';
import OSM from 'ol/source/OSM.js';
import TileLayer from 'ol/layer/Tile.js';
import View from 'ol/View.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { defaults as defaultControls } from 'ol/control.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import VectorSource from 'ol/source/Vector.js';
import VectorLayer from 'ol/layer/Vector.js';
import { Icon, Style } from 'ol/style.js';
import Overlay from 'ol/Overlay.js';
import { Draw } from 'ol/interaction.js';
import { LineString, Polygon, Circle as OlCircle } from 'ol/geom';
import { Modify } from 'ol/interaction';
import 'ol/proj';
import { transform } from 'ol/proj';
import WKT from 'ol/format/WKT';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import Circle from 'ol/geom/Circle';
import { toStringHDMS } from 'ol/coordinate.js';

class OLComponent extends HTMLElement {
    constructor() {
        super();
        this.shadow = this.attachShadow({ mode: 'open' });

        // CSS and Map setup
        const link = document.createElement('link');
        link.setAttribute('rel', 'stylesheet');
        link.setAttribute('href', 'styles.css');
        this.shadow.appendChild(link);

        const mapTarget = document.createElement('div');
        mapTarget.style.width = '100%';
        mapTarget.style.height = '100%';
        this.shadow.appendChild(mapTarget);

        const centerCoordinates = fromLonLat([32.8541, 39.9208]); // Center on Turkey

        // Initialize vector source and layer
        this.vectorSource = new VectorSource();
        this.vectorLayer = new VectorLayer({
            source: this.vectorSource,
        });

        // Create the map
        this.map = new Map({
            target: mapTarget,
            layers: [
                new TileLayer({
                    source: new OSM(),
                }),
                this.vectorLayer
            ],
            view: new View({
                center: centerCoordinates,
                zoom: 6,
            }),
            controls: defaultControls({
                zoom: false,
                attribution: false,
                rotate: false,
            }),
        });

        // Create popup elements
        this.popupContainer = document.createElement('div');
        this.popupContainer.className = 'ol-popup';
        this.shadow.appendChild(this.popupContainer);

        this.popupContent = document.createElement('div');
        this.popupContent.className = 'popup-content';
        this.popupContainer.appendChild(this.popupContent);

        this.popupCloser = document.createElement('button');
        this.popupCloser.className = 'popup-closer';
        this.popupCloser.innerHTML = '&times;';
        this.popupCloser.addEventListener('click', () => {
            this.popupOverlay.setPosition(undefined); // Hide popup when the closer is clicked
            this.popupContainer.style.display = 'none';
            this.popupCloser.blur();
        });
        this.popupContainer.appendChild(this.popupCloser);

        // Popup overlay to show info about features
        this.popupOverlay = new Overlay({
            element: this.popupContainer,
            autoPan: true,
            autoPanAnimation: {
                duration: 250,
            },
        });
        this.map.addOverlay(this.popupOverlay);

        // Create interactions for different WKT types
        this.lineStringDraw = new Draw({ source: this.vectorSource, type: 'LineString' });
        this.polygonDraw = new Draw({ source: this.vectorSource, type: 'Polygon' });
        this.circleDraw = new Draw({ source: this.vectorSource, type: 'Circle' });
        this.pointDraw = new Draw({ source: this.vectorSource, type: 'Point' });

        // Initially no active draw interaction
        this.currentDrawInteraction = null;

        // Set up event listeners for drawing end for all interactions
        this.setupDrawEndListeners();
    }

    connectedCallback() {
        this.fetchPoints(); // Fetch points from backend if needed

        // Zoom in functionality
        document.getElementById('zoom-in').addEventListener('click', () => {
            const view = this.map.getView();
            view.setZoom(view.getZoom() + 1);
        });

        // Zoom out functionality
        document.getElementById('zoom-out').addEventListener('click', () => {
            const view = this.map.getView();
            view.setZoom(view.getZoom() - 1);
        });

        // "Inserted Locations" button functionality
        document.getElementById('inserted-locations-button').addEventListener('click', () => {
            document.getElementById('locations-container').style.display = 'block';
            this.populateTable(); // Populate the locations table with points
        });

        // Close table button functionality
        document.getElementById('close-table-button').addEventListener('click', () => {
            document.getElementById('locations-container').style.display = 'none';
        });

        // Handle the WKT dropdown menu
        const wktMenu = document.getElementById('wkt-menu');
        document.getElementById('add-wkt-button').addEventListener('click', () => {
            alert('Click on the map to add a new shape.');
            wktMenu.style.display = wktMenu.style.display === 'flex' ? 'none' : 'flex';
        });

        // WKT options event listeners to activate corresponding interactions
        document.getElementById('wkt-point').addEventListener('click', () => {
            this.activateDrawInteraction('Point');
            wktMenu.style.display = 'none';
        });

        document.getElementById('wkt-linestring').addEventListener('click', () => {
            this.activateDrawInteraction('LineString');
            wktMenu.style.display = 'none';
        });

        document.getElementById('wkt-polygon').addEventListener('click', () => {
            this.activateDrawInteraction('Polygon');
            wktMenu.style.display = 'none';
        });

        document.getElementById('wkt-circle').addEventListener('click', () => {
            this.activateDrawInteraction('Circle');
            wktMenu.style.display = 'none';
        });

        // Handle popup showing on feature click
        this.map.on('singleclick', async (event) => {
            if (!this.isDrawing) {
                const features = this.map.getFeaturesAtPixel(event.pixel);
                if (features && features.length > 0) {
                    const feature = features[0];
                    const pointId = feature.get('id');
                    if (!pointId) {
                        console.error('Point ID is missing');
                        return;
                    }
                    await this.showPopup(pointId, feature); // Pass feature into showPopup
                } else {
                    this.popupOverlay.setPosition(undefined); // Hide popup if no features clicked
                    this.popupContainer.style.display = 'none';
                }
            }
        });

        // Close the WKT menu when clicking outside of it
        window.addEventListener('click', (event) => {
            if (!event.target.matches('#add-wkt-button') && !event.target.matches('.wkt-option') && wktMenu.style.display === 'flex') {
                wktMenu.style.display = 'none'; // Hide the menu if clicking outside
            }
        });
    }


    async showPopup(id, feature) {
        try {
            const response = await fetch(`https://localhost:7278/api/Point/${id}`);
            if (!response.ok) {
                console.error('Failed to fetch feature data:', response.statusText);
                return;
            }
            const data = await response.json();
            const { Name, Type, WKT } = data;
    
            // Update the popup content
            this.popupContent.innerHTML = `
                <h3>${Name || 'Unnamed'}</h3>
                <p>Coordinates: ${WKT || 'No coordinates available'}</p>
            `;
    
            // Get the coordinates of the clicked feature
            const centerCoordinates = this.map.getView().getCenter();
    
            // Show the popup and set its position to the feature's location
            this.popupOverlay.setPosition(centerCoordinates);
            this.popupContainer.classList.add('active'); // Add active class to show popup
        } catch (error) {
            console.error('Error fetching feature data:', error);
        }
    }
    setupDrawEndListeners() {
        // State to track current drawing mode
        this.isDrawing = false;
        
        this.pointDraw.on('drawend', async (event) => {
            const feature = event.feature;
            const coordinates = feature.getGeometry().getCoordinates();
            const lonLat = toLonLat(coordinates); // Converting coordinates to longitude/latitude
        
            // Create jsPanel for input
            jsPanel.create({
                headerTitle: 'Enter Point Name',
                theme: 'primary', // Add a theme if you'd like
                contentSize: '300 150', // Adjust dimensions as needed
                content: `
                    <div style="padding: 10px; text-align: center;">
                        <input type="text" id="pointNameInput" placeholder="Enter point name" 
                        style="width: 90%; padding: 8px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 4px;">
                        <button id="submitPointName" style="padding: 10px 20px; background-color: #4CAF50; color: white; border: none; border-radius: 4px;">Submit</button>
                    </div>
                `,
                callback: function (panel) {
                    // Safely remove the minimize/maximize/close buttons only if they exist
                    const closeButton = panel.header.querySelector('.jsPanel-btn-close');
                    const minButton = panel.header.querySelector('.jsPanel-btn-min');
                    const maxButton = panel.header.querySelector('.jsPanel-btn-max');
        
                    if (closeButton) closeButton.style.display = 'none';
                    if (minButton) minButton.style.display = 'none';
                    if (maxButton) maxButton.style.display = 'none';
        
                    // Add event listener for the button
                    document.getElementById('submitPointName').addEventListener('click', async () => {
                        const name = document.getElementById('pointNameInput').value;
                        if (name) {
                            const wkt = `POINT(${lonLat[0]} ${lonLat[1]})`;
                            
                            // Call your addPoint method to save the point
                            await this.addPoint(name, wkt);
        
                            // Remove feature after point has been added
                            this.vectorSource.removeFeature(feature);
                            this.map.removeInteraction(this.pointDraw);
                            this.isDrawing = false; // Reset drawing state
                            panel.close(); // Close the jsPanel
                        }
                    });
                }.bind(this), // Ensure the correct context for "this"
                position: 'center', // Center the panel on the screen
                dragit: { containment: 'window' }, // Restrict dragging to the window
            });
        });
        this.lineStringDraw.on('drawend', async (event) => {
            const feature = event.feature;
            const coordinates = feature.getGeometry().getCoordinates(); // Raw coordinates for LineString
        
            if (coordinates && Array.isArray(coordinates)) {
                // Convert to LonLat (EPSG:4326)
                const transformedCoords = coordinates.map(coord => transform(coord, 'EPSG:3857', 'EPSG:4326'));
        
                const wkt = `LINESTRING(${transformedCoords.map(coord => `${coord[0]} ${coord[1]}`).join(', ')})`;
        
                // Create jsPanel for input
                jsPanel.create({
                    headerTitle: 'Enter LineString Name',
                    theme: 'primary',
                    contentSize: '300 150',
                    content: `
                        <div style="padding: 10px; text-align: center;">
                            <input type="text" id="lineStringNameInput" placeholder="Enter LineString name" 
                            style="width: 90%; padding: 8px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 4px;">
                            <button id="submitLineStringName" style="padding: 10px 20px; background-color: #4CAF50; color: white; border: none; border-radius: 4px;">Submit</button>
                        </div>
                    `,
                    callback: function (panel) {
                        document.getElementById('submitLineStringName').addEventListener('click', async () => {
                            const name = document.getElementById('lineStringNameInput').value;
                            if (name) {
                                await this.addPoint(name, wkt); // Send to backend
                                this.vectorSource.removeFeature(feature);
                                this.map.removeInteraction(this.lineStringDraw);
                                this.isDrawing = false;
                                panel.close(); // Close the jsPanel
                            }
                        });
                    }.bind(this),
                    position: 'center',
                    dragit: { containment: 'window' },
                });
            }
        });
        
        // Polygon Draw
        this.polygonDraw.on('drawend', async (event) => {
            const feature = event.feature;
            const coordinates = feature.getGeometry().getCoordinates()[0]; // Raw coordinates
        
            const transformedCoords = coordinates.map(coord => transform(coord, 'EPSG:3857', 'EPSG:4326'));
            const wkt = `POLYGON((${transformedCoords.map(coord => `${coord[0]} ${coord[1]}`).join(', ')}))`;
        
            // Create jsPanel for input
            jsPanel.create({
                headerTitle: 'Enter Polygon Name',
                theme: 'primary',
                contentSize: '300 150',
                content: `
                    <div style="padding: 10px; text-align: center;">
                        <input type="text" id="polygonNameInput" placeholder="Enter Polygon name" 
                        style="width: 90%; padding: 8px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 4px;">
                        <button id="submitPolygonName" style="padding: 10px 20px; background-color: #4CAF50; color: white; border: none; border-radius: 4px;">Submit</button>
                    </div>
                `,
                callback: function (panel) {
                    document.getElementById('submitPolygonName').addEventListener('click', async () => {
                        const name = document.getElementById('polygonNameInput').value;
                        if (name) {
                            await this.addPoint(name, wkt); // Send to backend
        
                            // Create the polygon feature using draw_poly function
                            const polygonFeature = draw_poly(coordinates.concat([coordinates[0]]), style);
        
                            // Add the polygon feature to the vector source
                            this.vectorSource.addFeature(polygonFeature);
        
                            this.vectorSource.removeFeature(feature);
                            this.map.removeInteraction(this.polygonDraw);
                            this.isDrawing = false;
                            panel.close(); // Close the jsPanel
                        }
                    });
                }.bind(this),
                position: 'center',
                dragit: { containment: 'window' },
            });
        });
        
        // Circle Draw
        this.circleDraw.on('drawend', async (event) => {
            const feature = event.feature;
            const center = toLonLat(feature.getGeometry().getCenter());
            const radius = feature.getGeometry().getRadius();
            const wkt = `CIRCLE(${center[0]} ${center[1]}, ${radius})`;
        
            // Create jsPanel for input
            jsPanel.create({
                headerTitle: 'Enter Circle Name',
                theme: 'primary',
                contentSize: '300 150',
                content: `
                    <div style="padding: 10px; text-align: center;">
                        <input type="text" id="circleNameInput" placeholder="Enter Circle name" 
                        style="width: 90%; padding: 8px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 4px;">
                        <button id="submitCircleName" style="padding: 10px 20px; background-color: #4CAF50; color: white; border: none; border-radius: 4px;">Submit</button>
                    </div>
                `,
                callback: function (panel) {
                    document.getElementById('submitCircleName').addEventListener('click', async () => {
                        const name = document.getElementById('circleNameInput').value;
                        if (name) {
                            await this.addPoint(name, wkt); // Send to backend
        
                            this.vectorSource.removeFeature(feature);
                            this.map.removeInteraction(this.circleDraw);
                            this.isDrawing = false;
                            panel.close(); // Close the jsPanel
                        }
                    });
                }.bind(this),
                position: 'center',
                dragit: { containment: 'window' },
            });
        });
    }
    
    // Method to activate WKT drawing based on type
    activateDrawInteraction(type) {
        if (this.currentDrawInteraction) {
            this.map.removeInteraction(this.currentDrawInteraction);
        }

        switch (type) {
            case 'Point':
                this.currentDrawInteraction = this.pointDraw;
                break;
            case 'LineString':
                this.currentDrawInteraction = this.lineStringDraw;
                break;
            case 'Polygon':
                this.currentDrawInteraction = this.polygonDraw;
                break;
            case 'Circle':
                this.currentDrawInteraction = this.circleDraw;
                break;
        }

        this.map.addInteraction(this.currentDrawInteraction);
    }


   // Method to activate WKT drawing based on type
   activateDrawInteraction(type) {
    // Deactivate the current draw interaction
    if (this.currentDrawInteraction) {
        this.map.removeInteraction(this.currentDrawInteraction);
    }

    // Activate the chosen draw interaction
    switch (type) {
        case 'Point':
            this.currentDrawInteraction = this.pointDraw;
            break;
        case 'LineString':
            this.currentDrawInteraction = this.lineStringDraw;
            break;
        case 'Polygon':
            this.currentDrawInteraction = this.polygonDraw;
            break;
        case 'Circle':
            this.currentDrawInteraction = this.circleDraw;
            break;
        default:
            this.currentDrawInteraction = null;
    }

    if (this.currentDrawInteraction) {
        this.map.addInteraction(this.currentDrawInteraction);
    }
}

        // Method to populate the DataTable and set up event listeners
// Method to populate the DataTable and set up event listeners
async populateTable() {
    try {
        const response = await fetch('https://localhost:7278/api/point');   
        const points = await response.json();

        const table = $('#locations-table').DataTable();
        table.clear();

        points.forEach(point => {
            table.row.add([ 
                point.id,
                point.WKT,
                point.Name,
                `<button class="update-point" data-id="${point.id}" data-wkt="${point.WKT}" data-name="${point.Name}">Update</button>
                 <button class="delete-point" data-id="${point.id}">Delete</button>`
                 
            ]).draw();
        });

        // Add event listeners for the "Delete" button
        document.querySelectorAll('.delete-point').forEach(button => {
            button.addEventListener('click', (event) => {
                const pointId = event.target.dataset.id;
                this.deletePoint(pointId);
            });
        });

        // Add event listeners for the "Update" button
        document.querySelectorAll('.update-point').forEach(button => {
            button.addEventListener('click', (event) => {
                const pointId = event.target.dataset.id;
                const wkt = event.target.dataset.wkt;
                const name = event.target.dataset.name;

                // Prompt the user for updated name
                const newName = prompt("Enter new name:", name);
                if (newName) {
                    // Prompt for new coordinates
                    const newCoordinates = prompt("Enter new coordinates (WKT format):", wkt);
                    if (newCoordinates) {
                        // Call the updatePoint function with the new WKT and name
                        this.updatePoint(pointId, newCoordinates, newName);
                    } else {
                        alert('Invalid input. Please provide valid coordinates.');
                    }
                } else {
                    alert('Invalid input. Please provide a valid name.');
                }
            });
        });
    } catch (error) {
        console.error('Error fetching points for table:', error);
    }
}

        
    


        async fetchPoints() {
            try {
                const response = await fetch('https://localhost:7278/api/point'); // Adjust URL if needed
                const points = await response.json();
                
                this.vectorSource.clear(); // Clear existing features
        
                // Initialize WKT format parser
                const wktFormat = new WKT();
        
                points.forEach(point => {
                    try {
                        const wkt = point.WKT;
                        console.log('WKT from backend:', wkt); // Debugging line
                        
                        let feature;
        
                        // Handle CIRCLE type manually
                        if (wkt.startsWith('CIRCLE')) {
                            // Use regex to extract the circle WKT components
                            const circleMatch = wkt.match(/CIRCLE\(\s*([^\s]+)\s+([^\s]+),\s*([^\s]+)\s*\)/);
                            if (circleMatch) {
                                const lon = parseFloat(circleMatch[1]);
                                const lat = parseFloat(circleMatch[2]);
                                const radius = parseFloat(circleMatch[3]);
        
                                const center = [lon, lat]; // Lon, Lat from WKT
                                const transformedCenter = fromLonLat(center); // Transform to map projection
        
                                // Create the Circle geometry in map projection (EPSG:3857)
                                const circleGeometry = new Circle(transformedCenter, radius);
                                feature = new Feature(circleGeometry); // Create feature with the circle geometry
                            } else {
                                console.error('Invalid CIRCLE WKT format:', wkt);
                            }
                        } else {
                            // Parse other WKT types (POINT, LINESTRING, POLYGON)
                            feature = wktFormat.readFeature(wkt, {
                                dataProjection: 'EPSG:4326',     // Assuming backend sends WKT in EPSG:4326 (lat/lon)
                                featureProjection: 'EPSG:3857'   // Map's projection (Web Mercator)
                            });
                        }
        
                        // Check if the geometry was parsed correctly
                        if (feature) {
                            // Set additional properties such as id and name
                            feature.setProperties({
                                id: point.id,
                                name: point.Name
                            });
        
                            // Apply a style if necessary
                            feature.setStyle(new Style({
                                image: new Icon({
                                    src: 'icons/gps.png', // Adjust icon path if needed
                                    scale: 0.051
                                }),
                                stroke: new Stroke({
                                    color: '#0092ca',
                                    width: 2
                                }),
                                fill: new Fill({
                                    color: 'rgba(255, 255, 255, 0.5)'
                                })
                            }));
        
                            // Add the feature to the vector source
                            this.vectorSource.addFeature(feature);
                        } else {
                            console.error('Failed to parse WKT:', wkt);
                        }
                    } catch (parseError) {
                        console.error('Error parsing WKT or adding feature:', parseError);
                    }
                });
            } catch (error) {
                console.error('Error fetching points:', error);
            }
        }

        async addPoint(name, wkt) {
            const pointData = {
                name: name,
                WKT: wkt
            };
        
            try {
                const response = await fetch('https://localhost:7278/api/point', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(pointData)
                });
        
                const result = await response.json();
                console.log('Backend response:', result); // Log response for debugging
        
                // Ensure the WKT is valid before proceeding
                if (!result.WKT) {
                    throw new Error('Backend returned invalid WKT');
                }
        
                const geometry = this.parseWKT(result.WKT);
        
                let featureGeometry;
                if (wkt.startsWith('POINT')) {
                    const coordinate = fromLonLat(geometry);
                    featureGeometry = new Point(coordinate);
                } else if (wkt.startsWith('LINESTRING')) {
                    const coordinates = geometry.map(fromLonLat);
                    featureGeometry = new LineString(coordinates);
                } else if (wkt.startsWith('POLYGON')) {
                    const coordinates = geometry.map(fromLonLat);
                    featureGeometry = new Polygon([coordinates]);
                } else if (wkt.startsWith('CIRCLE')) {
                    const [center, radius] = geometry;
                    featureGeometry = new Circle(fromLonLat(center), radius);
                }
        
                if (featureGeometry) {
                    const marker = new Feature({
                        geometry: featureGeometry,
                        id: result.id,
                        name: result.Name
                    });
        
                    marker.setStyle(new Style({
                        image: new Icon({
                            src: 'icons/gps.png',
                            scale: 0.051
                        })
                    }));
        
                    this.vectorSource.addFeature(marker);
                }
        
            } catch (error) {
                console.error('Error adding point:', error);
            }
        }

    parseWKT(wkt) {
        if (!wkt || typeof wkt !== 'string') {
            throw new Error('Invalid or undefined WKT');
        }
    
        const pointMatch = wkt.match(/POINT\(\s*([^\s]+)\s+([^\s]+)\s*\)/);
        if (pointMatch) {
            const lon = parseFloat(pointMatch[1]);
            const lat = parseFloat(pointMatch[2]);
            return [[lon, lat]]; // Return as an array of coordinates
        }
    
        const lineStringMatch = wkt.match(/LINESTRING\(([^)]+)\)/);
        if (lineStringMatch) {
            return lineStringMatch[1].split(',').map(coord => {
                const [lon, lat] = coord.trim().split(' ').map(Number);
                return [lon, lat];
            });
        }
    
        const polygonMatch = wkt.match(/POLYGON\(\(\s*([^)]*)\s*\)\)/);
        if (polygonMatch) {
            return polygonMatch[1].split(',').map(coord => {
                const [lon, lat] = coord.trim().split(' ').map(Number);
                return [lon, lat];
            });
        }
    
        // Handle Circle or throw an error if unsupported
        const circleMatch = wkt.match(/CIRCLE\(\s*([^,]+),\s*([^\)]+)\s*\)/);
        if (circleMatch) {
            const [center, radius] = circleMatch.slice(1);
            const [lon, lat] = center.split(' ').map(Number);
            return [[lon, lat], parseFloat(radius)];
        }
    
        throw new Error('Unsupported WKT format');
    }

// Method to update the point on both the map and the backend
async updatePoint(id, wkt, name) {
    const pointData = {
        id: id, // Ensure the ID is sent to the backend
        WKT: wkt, // Use WKT directly
        Name: name // Ensure the property matches the backend
    };

    try {
        const response = await fetch(`https://localhost:7278/api/Point/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(pointData),
        });

        const result = await response.json();
        console.log(result.message);

        // Update the feature on the map
        const feature = this.vectorSource.getFeatureById(id);
        if (feature) {
            const coordinates = this.parseWKT(wkt); // Use your existing parseWKT function
            feature.setId(result.id); // Update the ID on the feature
            feature.setGeometry(new ol.geom.Point(coordinates[0])); // Use the parsed coordinates
            feature.set('name', name); // Update the name on the feature as well
        }
    } catch (error) {
        console.error('Error updating point:', error);
    }
}


async addWKTFeature(wkt) {
    const pointData = {
        WKT: wkt
    };

    try {
        const response = await fetch('https://localhost:7278/api/point', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(pointData)
        });

        const result = await response.json();

        const coordinates = this.parseWKT(result.WKT); // Parse WKT to get coordinates
        const coordinate = fromLonLat(coordinates); // Transform to map projection
        
        const newFeature = new Feature({
            geometry: new Point(coordinate),
            id: result.id,
            name: result.Name
        });

        newFeature.setStyle(new Style({
            image: new Icon({
                src: 'icons/gps.png',
                scale: 0.051
            })
        }));

        this.vectorSource.addFeature(newFeature); // Add new feature to the vector layer
    } catch (error) {
        console.error('Error adding WKT feature:', error);
    }
}   


    async deletePoint(id) {
        console.log(`Attempting to delete point with id: ${id}`);
        if (confirm("Are you sure you want to delete this location?")) {
            try {
                const response = await fetch(`https://localhost:7278/api/point/${id}`, {
                    method: 'DELETE',
                });
    
                if (response.ok) {
                    console.log("Point deleted successfully");
    
                    // Remove feature from the map
                    const feature = this.vectorSource.getFeatureById(id);
                    if (feature) {
                        this.vectorSource.removeFeature(feature);
                    }
    
                    // Remove row from DataTable
                    const table = $('#locations-table').DataTable();
                    const row = table.row(`button[data-id="${id}"]`).parents('tr');
                    if (row.length) {
                        row.remove().draw();
                    }
                } else {
                    const errorMessage = await response.text();
                    alert(`Error deleting point: ${errorMessage}`);
                }
            } catch (error) {
                alert('Point deleted successfully');
            }
        }
    }
}
        

    



// Register custom element
customElements.define('ol-map', OLComponent);
