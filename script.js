pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

        
        let pdfDoc = null;
        let pageNum = 1;
        let pageRendering = false;
        let pageNumPending = null;
        let scale = 1.5;
        let canvas = document.getElementById('pdf-canvas');
        let ctx = canvas.getContext('2d');
        let textLayer = document.getElementById('text-layer');
        let editableElements = [];
        let imageElements = [];
        let originalPdfData = null;
        let textScalingFactors = {};

        document.getElementById('pdf-file').addEventListener('change', handleFileSelect);
        document.getElementById('add-image').addEventListener('click', () => document.getElementById('image-file').click());
        document.getElementById('image-file').addEventListener('change', handleImageSelect);
        document.getElementById('save-pdf').addEventListener('click', savePDF);
        document.getElementById('prev-page').addEventListener('click', onPrevPage);
        document.getElementById('next-page').addEventListener('click', onNextPage);

        function handleFileSelect(event) {
            const file = event.target.files[0];
            if (file && file.type === 'application/pdf') {
                const fileReader = new FileReader();
                
                document.getElementById('loading-spinner').style.display = 'block';
                
                fileReader.onload = function(event) {
                    const typedarray = new Uint8Array(event.target.result);
                    originalPdfData = typedarray;
                    loadPdfFromData(typedarray);
                };
                
                fileReader.readAsArrayBuffer(file);
            }
        }

        function loadPdfFromData(data) {
            textLayer.innerHTML = '';
            editableElements = [];
            imageElements = [];
            
            pdfjsLib.getDocument({data: data}).promise.then(function(pdf) {
                pdfDoc = pdf;
                document.getElementById('page-num').textContent = `Page ${pageNum} of ${pdf.numPages}`;
                
                renderPage(pageNum);
            }).catch(function(error) {
                console.error('Error loading PDF:', error);
                document.getElementById('loading-spinner').style.display = 'none';
                alert('Error loading PDF: ' + error.message);
            });
        }
function renderPage(num) {
    pageRendering = true;
    document.getElementById('loading-spinner').style.display = 'block';
    textLayer.innerHTML = '';
    
    pdfDoc.getPage(num).then(function(page) {
        const viewport = page.getViewport({ scale: scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;

        const renderContext = {
            canvasContext: ctx,
            viewport: viewport,
            renderInteractiveForms: false,
            enableWebGL: true
        };

        const renderTask = page.render(renderContext);

        page.getTextContent().then(function(textContent) {
            // Analyze the document's fonts
            const fontAnalysis = analyzeFonts(textContent);
            
            // Extract all font data from the PDF
            const fontDataPromises = [];
            const fontMap = {};
            
            // Get all fonts used in the document
            for (const item of textContent.items) {
                if (!fontMap[item.fontName]) {
                    fontMap[item.fontName] = true;
                    fontDataPromises.push(page.commonObjs.get(item.fontName));
                }
            }
            
            // Process all text content once we have font data
            Promise.all(fontDataPromises).then(fontDataArray => {
                // Create a mapping of font names to their actual properties
                const fontDataMap = {};
                
                // Map font data to font names for better access
                fontDataArray.forEach((fontData, index) => {
                    const fontName = Object.keys(fontMap)[index];
                    if (fontData && fontData.data) {
                        fontDataMap[fontName] = fontData.data;
                    }
                });
                
                // Process each item
                textContent.items.forEach(function(item, index) {
                    // Use complete transform matrix for precise positioning and sizing
                    const tx = pdfjsLib.Util.transform(
                        viewport.transform,
                        item.transform
                    );
                    
                    // Extract font size using proper scaling
                    // PDF uses a coordinate system where 1 unit = 1/72 inch
                    // Calculate font size based on the transformation matrix scale
                    // This is more accurate than the previous approach
                    const fontScaleX = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
                    const fontScaleY = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
                    
                    // Use the average of X and Y scale for better sizing
                    const rawFontSize = (fontScaleX + fontScaleY) / 2;
                    
                    // Apply viewport scaling to get the final size in pixels
                    // The multiplier 1.2 is a calibration factor that better matches browser rendering
                    const fontSize = Math.round(rawFontSize * 1.2 * 10) / 10;
                    
                    // Get precise font properties using improved extraction
                    const fontData = extractEnhancedFontData(item.fontName, fontDataMap, fontAnalysis);
                    
                    // Create editable element with more accurate styling
                    const div = document.createElement('div');
                    div.setAttribute('data-item-index', index);
                    div.setAttribute('data-font-name', item.fontName);
                    div.setAttribute('data-original-font-size', `${fontSize}px`);
                    div.setAttribute('data-font-scale', '1');
                    div.className = 'editable-element';
                    div.contentEditable = true;
                    div.textContent = item.str;
                    
                    // Apply more precise positioning and styling
                    div.style.position = 'absolute';
                    div.style.left = `${tx[4]}px`;
                    div.style.top = `${tx[5] - fontScaleY}px`; // Adjust for baseline
                    div.style.fontSize = `${fontSize}px`;
                    div.style.fontFamily = fontData.fontFamily;
                    div.style.fontWeight = fontData.fontWeight;
                    div.style.fontStyle = fontData.fontStyle;
                    div.style.letterSpacing = `${fontData.letterSpacing}px`;
                    div.style.lineHeight = fontData.lineHeight;
                    div.style.color = fontData.color || 'black';
                    
                    // Apply text-rendering optimization for better font display
                    div.style.textRendering = 'optimizeLegibility';
                    
                    // Apply precise rotation from transformation matrix
                    const angle = Math.atan2(tx[1], tx[0]);
                    div.style.transform = `rotate(${angle}rad)`;
                    div.style.transformOrigin = 'left bottom';
                    
                    // Calculate precise width based on character spacing and font metrics
                    const width = Math.max(1, item.width * viewport.scale * 1.05); // Add 5% for safety
                    div.style.minWidth = `${width}px`;
                    
                    // Draw white background for better visibility
                    ctx.fillStyle = 'white';
                    ctx.fillRect(
                        tx[4] - 1, 
                        tx[5] - fontScaleY - 1, 
                        width + 2, 
                        fontScaleY + 4
                    );
                    
                    // Append to text layer
                    textLayer.appendChild(div);
                    editableElements.push(div);
                    
                    // Initialize scaling factor
                    textScalingFactors[index] = 1.0;
                });
                
                renderTask.promise.then(function() {
                    pageRendering = false;
                    document.getElementById('loading-spinner').style.display = 'none';
                    if (pageNumPending !== null) {
                        renderPage(pageNumPending);
                        pageNumPending = null;
                    }
                });
            }).catch(err => {
                console.error('Error processing fonts:', err);
                pageRendering = false;
                document.getElementById('loading-spinner').style.display = 'none';
            });
        });
    });
}
function extractEnhancedFontData(fontName, fontDataMap, fontAnalysis) {
    // More comprehensive mapping of standard PDF fonts
    const fontMapping = {
        // Standard PDF fonts with more precise properties
        'Helvetica': {
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontWeight: 'normal',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: false
        },
        'Helvetica-Bold': {
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontWeight: 'bold',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: false
        },
        'Helvetica-Oblique': {
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontWeight: 'normal',
            fontStyle: 'italic',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: false
        },
        'Helvetica-BoldOblique': {
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontWeight: 'bold',
            fontStyle: 'italic',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: false
        },
        'Times-Roman': {
            fontFamily: 'Times New Roman, serif',
            fontWeight: 'normal',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: true
        },
        'Times-Bold': {
            fontFamily: 'Times New Roman, serif',
            fontWeight: 'bold',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: true
        },
        'Times-Italic': {
            fontFamily: 'Times New Roman, serif',
            fontWeight: 'normal',
            fontStyle: 'italic',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: true
        },
        'Times-BoldItalic': {
            fontFamily: 'Times New Roman, serif',
            fontWeight: 'bold',
            fontStyle: 'italic',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: true
        },
        'Courier': {
            fontFamily: 'Courier New, monospace',
            fontWeight: 'normal',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isMonospace: true
        },
        'Courier-Bold': {
            fontFamily: 'Courier New, monospace',
            fontWeight: 'bold',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isMonospace: true
        },
        'Courier-Oblique': {
            fontFamily: 'Courier New, monospace',
            fontWeight: 'normal',
            fontStyle: 'italic',
            letterSpacing: 0,
            lineHeight: '1.2',
            isMonospace: true
        },
        'Courier-BoldOblique': {
            fontFamily: 'Courier New, monospace',
            fontWeight: 'bold',
            fontStyle: 'italic',
            letterSpacing: 0,
            lineHeight: '1.2',
            isMonospace: true
        },
        'Symbol': {
            fontFamily: 'Symbol, serif',
            fontWeight: 'normal',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSymbol: true
        },
        'ZapfDingbats': {
            fontFamily: 'ZapfDingbats, fantasy',
            fontWeight: 'normal',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSymbol: true
        },
        // Add additional common fonts that appear in PDFs
        'Arial': {
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'normal',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: false
        },
        'Arial-Bold': {
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: false
        },
        'Arial-Italic': {
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'normal',
            fontStyle: 'italic',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: false
        },
        'Arial-BoldItalic': {
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            fontStyle: 'italic',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: false
        },
        'Calibri': {
            fontFamily: 'Calibri, sans-serif',
            fontWeight: 'normal',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: false
        },
        'Verdana': {
            fontFamily: 'Verdana, sans-serif',
            fontWeight: 'normal',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: false
        },
        'Georgia': {
            fontFamily: 'Georgia, serif',
            fontWeight: 'normal',
            fontStyle: 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: true
        }
    };

    // Check if we have a direct match in our mapping
    let fontData = fontMapping[fontName];
    
    // If no direct match, try to extract properties from the font name
    if (!fontData) {
        // Extract font family from composite font names (often has format ABCDEF+FontName)
        let fontFamily = fontName;
        if (fontName.includes('+')) {
            fontFamily = fontName.split('+').pop();
        }
        
        // Remove any suffixes that might contain style info
        if (fontFamily.includes('-')) {
            const baseFontName = fontFamily.split('-')[0];
            fontFamily = baseFontName;
        }
        
        // Determine style properties from the font name
        const isBold = fontName.toLowerCase().includes('bold') || 
                      fontName.toLowerCase().includes('black') || 
                      fontName.toLowerCase().includes('heavy');
                      
        const isItalic = fontName.toLowerCase().includes('italic') || 
                        fontName.toLowerCase().includes('oblique') || 
                        fontName.toLowerCase().includes('slant');
                        
        const isSerif = fontName.toLowerCase().includes('times') || 
                       fontName.toLowerCase().includes('roman') || 
                       fontName.toLowerCase().includes('serif') ||
                       fontName.toLowerCase().includes('georgia');
                       
        const isMonospace = fontName.toLowerCase().includes('mono') || 
                           fontName.toLowerCase().includes('courier') ||
                           fontName.toLowerCase().includes('typewriter');
        
        // Create font data object
        fontData = {
            fontFamily: `"${fontFamily}", ${isSerif ? 'serif' : isMonospace ? 'monospace' : 'sans-serif'}`,
            fontWeight: isBold ? 'bold' : 'normal',
            fontStyle: isItalic ? 'italic' : 'normal',
            letterSpacing: 0,
            lineHeight: '1.2',
            isSerif: isSerif,
            isMonospace: isMonospace
        };
    }
    
    // Get additional font info from PDF font data if available
    if (fontDataMap && fontDataMap[fontName]) {
        // Extract additional properties from the font object
        const pdfFontData = fontDataMap[fontName];
        
        // If available, use ascent/descent information for better line height
        if (pdfFontData.ascent && pdfFontData.descent) {
            const ascent = Math.abs(pdfFontData.ascent || 0.8);
            const descent = Math.abs(pdfFontData.descent || 0.2);
            const lineHeight = (ascent + descent) * 1.2; // Add a bit of extra spacing
            fontData.lineHeight = lineHeight.toFixed(2);
        }
        
        // Check for font-weight in the actual font data
        if (pdfFontData.fontWeight) {
            // Convert string weights to numbers if needed
            if (typeof pdfFontData.fontWeight === 'string') {
                switch (pdfFontData.fontWeight.toLowerCase()) {
                    case 'bold': fontData.fontWeight = 'bold'; break;
                    case 'normal': fontData.fontWeight = 'normal'; break;
                    default:
                        // Try to parse numeric weight
                        const numWeight = parseInt(pdfFontData.fontWeight);
                        if (!isNaN(numWeight)) {
                            fontData.fontWeight = numWeight > 500 ? 'bold' : 'normal';
                        }
                }
            } else if (typeof pdfFontData.fontWeight === 'number') {
                fontData.fontWeight = pdfFontData.fontWeight > 500 ? 'bold' : 'normal';
            }
        }
    }
    
    // Apply character spacing adjustments if available from analysis
    if (fontAnalysis && fontAnalysis.fontCharacteristics[fontName]) {
        const avgWidth = fontAnalysis.fontCharacteristics[fontName].avgCharWidth;
        // Adjust letter spacing based on average character width
        if (avgWidth > 0.15) {
            fontData.letterSpacing = ((avgWidth - 0.1) * 0.5).toFixed(2);
        }
    }
    
    return fontData;
}
function analyzeFonts(textContent) {
    const fontFrequency = {};
    const fontCharacteristics = {};
    const fontColors = {};
    
    // Analyze all text items to understand font usage
    textContent.items.forEach(item => {
        // Count font occurrences
        fontFrequency[item.fontName] = (fontFrequency[item.fontName] || 0) + 1;
        
        // Track character width to determine spacing
        if (!fontCharacteristics[item.fontName]) {
            fontCharacteristics[item.fontName] = {
                charWidths: [],
                totalChars: 0,
                heights: [],
                transforms: []
            };
        }
        
        // Calculate average character width
        const charWidth = item.width / item.str.length;
        fontCharacteristics[item.fontName].charWidths.push(charWidth);
        fontCharacteristics[item.fontName].totalChars += item.str.length;
        
        // Store transform data to analyze font heights
        if (item.height) {
            fontCharacteristics[item.fontName].heights.push(item.height);
        }
        
        // Store complete transform matrix for later analysis
        if (item.transform) {
            fontCharacteristics[item.fontName].transforms.push(item.transform);
        }
        
        // Track color information if available
        if (item.color) {
            if (!fontColors[item.fontName]) {
                fontColors[item.fontName] = [];
            }
            fontColors[item.fontName].push(item.color);
        }
    });
    
    // Calculate average metrics for each font
    for (const fontName in fontCharacteristics) {
        const chars = fontCharacteristics[fontName];
        
        // Average character width
        const widths = chars.charWidths;
        chars.avgCharWidth = widths.reduce((sum, width) => sum + width, 0) / widths.length;
        
        // Average height if available
        if (chars.heights.length > 0) {
            chars.avgHeight = chars.heights.reduce((sum, h) => sum + h, 0) / chars.heights.length;
        }
        
        // Analyze transformations for consistent scaling factors
        if (chars.transforms.length > 0) {
            // Calculate average scaling from transforms
            let scaleX = 0, scaleY = 0;
            chars.transforms.forEach(t => {
                scaleX += Math.sqrt(t[0] * t[0] + t[1] * t[1]);
                scaleY += Math.sqrt(t[2] * t[2] + t[3] * t[3]);
            });
            chars.avgScaleX = scaleX / chars.transforms.length;
            chars.avgScaleY = scaleY / chars.transforms.length;
        }
    }
    
    // Determine most common color per font if available
    const fontMostCommonColors = {};
    for (const fontName in fontColors) {
        const colorCounts = {};
        let mostCommon = null;
        let maxCount = 0;
        
        fontColors[fontName].forEach(color => {
            const colorStr = color.join(',');
            colorCounts[colorStr] = (colorCounts[colorStr] || 0) + 1;
            
            if (colorCounts[colorStr] > maxCount) {
                maxCount = colorCounts[colorStr];
                mostCommon = color;
            }
        });
        
        if (mostCommon) {
            fontMostCommonColors[fontName] = mostCommon;
        }
    }
    
    return {
        fontFrequency,
        fontCharacteristics,
        fontMostCommonColors
    };
}
        

        function addFontSizeAdjustment() {
            const fontSizeContainer = document.createElement('div');
            fontSizeContainer.className = 'font-size-controls';
            fontSizeContainer.style.display = 'flex';
            fontSizeContainer.style.alignItems = 'center';
            fontSizeContainer.style.marginRight = '15px';
            
            const fontSizeLabel = document.createElement('span');
            fontSizeLabel.textContent = 'Font Size:';
            fontSizeLabel.style.marginRight = '5px';
            
            const decreaseFontBtn = document.createElement('button');
            decreaseFontBtn.innerHTML = 'A-';
            decreaseFontBtn.title = 'Decrease font size';
            decreaseFontBtn.style.padding = '4px 8px';
            decreaseFontBtn.style.fontSize = '12px';
            const increaseFontBtn = document.createElement('button');
            increaseFontBtn.innerHTML = 'A+';
            increaseFontBtn.title = 'Increase font size';
            increaseFontBtn.style.padding = '4px 8px';
            increaseFontBtn.style.fontSize = '12px';
            const resetFontBtn = document.createElement('button');
            resetFontBtn.innerHTML = 'Reset';
            resetFontBtn.title = 'Reset font size';
            resetFontBtn.style.padding = '4px 8px';
            resetFontBtn.style.fontSize = '12px';
            decreaseFontBtn.addEventListener('click', () => adjustSelectedFontSize(0.9));
            increaseFontBtn.addEventListener('click', () => adjustSelectedFontSize(1.1));
            resetFontBtn.addEventListener('click', () => resetFontSize());
            fontSizeContainer.appendChild(fontSizeLabel);
            fontSizeContainer.appendChild(decreaseFontBtn);
            fontSizeContainer.appendChild(increaseFontBtn);
            fontSizeContainer.appendChild(resetFontBtn);
            const pageInfo = document.getElementById('page-info');
            document.querySelector('.toolbar').insertBefore(fontSizeContainer, pageInfo);
        }
        function adjustSelectedFontSize(factor) {
            const selection = window.getSelection();
            let elementsToAdjust = [];
            
            if (selection && !selection.isCollapsed) {
                const range = selection.getRangeAt(0);
                const container = range.commonAncestorContainer;
                
                if (container.nodeType === Node.TEXT_NODE) {
                    if (container.parentElement.classList.contains('editable-element')) {
                        elementsToAdjust.push(container.parentElement);
                    }
                } else {
                    const selectedElements = textLayer.querySelectorAll('.editable-element');
                    selectedElements.forEach(el => {
                        if (selection.containsNode(el, true)) {
                            elementsToAdjust.push(el);
                        }
                    });
                }
            } else {
                const activeElement = document.activeElement;
                if (activeElement && activeElement.classList.contains('editable-element')) {
                    elementsToAdjust.push(activeElement);
                }
            }
            elementsToAdjust.forEach(element => {
                const elementId = element.getAttribute('data-item-index');
                if (!textScalingFactors[elementId]) {
                    textScalingFactors[elementId] = 1.0;
                }
                textScalingFactors[elementId] *= factor;
                const currentSize = parseFloat(window.getComputedStyle(element).fontSize);
                const newSize = currentSize * factor;
                element.style.fontSize = `${newSize}px`;
                element.setAttribute('data-font-scale', textScalingFactors[elementId]);
            });
        }
        function resetFontSize() {
            const selection = window.getSelection();
            let elementsToReset = [];
            
            if (selection && !selection.isCollapsed) {
                const selectedElements = textLayer.querySelectorAll('.editable-element');
                selectedElements.forEach(el => {
                    if (selection.containsNode(el, true)) {
                        elementsToReset.push(el);
                    }
                });
            } else {
                const activeElement = document.activeElement;
                if (activeElement && activeElement.classList.contains('editable-element')) {
                    elementsToReset.push(activeElement);
                } else {
                    elementsToReset = Array.from(textLayer.querySelectorAll('.editable-element'));
                }
            }
            
            elementsToReset.forEach(element => {
                const elementId = element.getAttribute('data-item-index');
                const originalFontSize = element.getAttribute('data-original-font-size');
                
                if (originalFontSize) {
                    element.style.fontSize = originalFontSize;
                    textScalingFactors[elementId] = 1.0;
                    element.setAttribute('data-font-scale', '1');
                }
            });
        }
        
        
        function addFontSizeKeyboardShortcuts() {
            document.addEventListener('keydown', function(e) {
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' || 
                    e.target.classList.contains('editable-element')) {
                    
                    if (e.ctrlKey && e.key === '+') {
                        e.preventDefault();
                        adjustSelectedFontSize(1.1);
                    }
                    
                    if (e.ctrlKey && e.key === '-') {
                        e.preventDefault();
                        adjustSelectedFontSize(0.9);
                    }
                    
                    if (e.ctrlKey && e.key === '0') {
                        e.preventDefault();
                        resetFontSize();
                    }
                }
            });
        }
        
        function modifyTextElementCreation() {
            const originalRenderPage = renderPage;
            
            renderPage = function(num) {
                pageRendering = true;
                document.getElementById('loading-spinner').style.display = 'block';
                textLayer.innerHTML = '';
                pdfDoc.getPage(num).then(function(page) {
                    const viewport = page.getViewport({ scale: scale });
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    textLayer.style.width = `${viewport.width}px`;
                    textLayer.style.height = `${viewport.height}px`;
            
                    const renderContext = {
                        canvasContext: ctx,
                        viewport: viewport,
                        renderInteractiveForms: false,
                        enableWebGL: true
                    };
            
                    const renderTask = page.render(renderContext);
            
                    page.getTextContent().then(function(textContent) {
                        const fontDataPromises = [];
                        const fontMap = {};
                        for (const item of textContent.items) {
                            if (!fontMap[item.fontName]) {
                                fontMap[item.fontName] = true;
                                fontDataPromises.push(page.commonObjs.get(item.fontName));
                            }
                        }
                        Promise.all(fontDataPromises).then(fontDataArray => {
                            const fontDataMap = {};
                            textContent.items.forEach(function(item, index) {
                                const tx = pdfjsLib.Util.transform(
                                    viewport.transform,
                                    item.transform
                                );
                                const fontScaleX = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
                                const fontScaleY = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
                                const fontSize = Math.round((fontScaleY / viewport.scale) * 100) / 100;
                                
                                const fontData = extractFontData(item.fontName);
                                const div = document.createElement('div');
                                div.setAttribute('data-item-index', index);
                                div.setAttribute('data-font-name', item.fontName);
                                div.setAttribute('data-original-font-size', `${fontSize}px`); // Store original size
                                div.setAttribute('data-font-scale', '1'); // Initial scale factor
                                div.className = 'editable-element';
                                div.contentEditable = true;
                                div.textContent = item.str;
                                
                                // Apply precise transformations
                                div.style.position = 'absolute';
                                div.style.left = `${tx[4]}px`;
                                div.style.top = `${tx[5] - fontScaleY}px`;
                                div.style.fontSize = `${fontSize}px`;
                                div.style.fontFamily = fontData.fontFamily;
                                div.style.fontWeight = fontData.fontWeight;
                                div.style.fontStyle = fontData.fontStyle;
                                div.style.letterSpacing = `${fontData.letterSpacing}px`;
                                div.style.lineHeight = `${fontData.lineHeight}`;
                            
                                const angle = Math.atan2(tx[1], tx[0]);
                                div.style.transform = `rotate(${angle}rad)`;
                                div.style.transformOrigin = 'left bottom';
                                const width = item.width * viewport.scale;
                                div.style.minWidth = `${width}px`;
                                ctx.fillStyle = 'white';
                                ctx.fillRect(
                                    tx[4] - 1, 
                                    tx[5] - fontScaleY - 1, 
                                    width + 2, 
                                    fontScaleY + 4
                                );
                                textLayer.appendChild(div);
                                editableElements.push(div);
                                textScalingFactors[index] = 1.0;
                            });
                            
                            renderTask.promise.then(function() {
                                pageRendering = false;
                                document.getElementById('loading-spinner').style.display = 'none';
                                if (pageNumPending !== null) {
                                    renderPage(pageNumPending);
                                    pageNumPending = null;
                                }
                            });
                        }).catch(err => {
                            console.error('Error processing fonts:', err);
                            pageRendering = false;
                            document.getElementById('loading-spinner').style.display = 'none';
                        });
                    });
                });
            };
        }
        function addFontContextMenu() {
            const contextMenu = document.createElement('div');
            contextMenu.className = 'context-menu';
            contextMenu.style.position = 'absolute';
            contextMenu.style.background = 'white';
            contextMenu.style.border = '1px solid #ccc';
            contextMenu.style.boxShadow = '2px 2px 5px rgba(0,0,0,0.2)';
            contextMenu.style.padding = '5px 0';
            contextMenu.style.zIndex = '1000';
            contextMenu.style.display = 'none';
            const menuItems = [
                { text: 'Increase Font Size', action: () => adjustSelectedFontSize(1.1) },
                { text: 'Decrease Font Size', action: () => adjustSelectedFontSize(0.9) },
                { text: 'Reset Font Size', action: () => resetFontSize() }
            ];
            menuItems.forEach(item => {
                const menuItem = document.createElement('div');
                menuItem.textContent = item.text;
                menuItem.style.padding = '8px 15px';
                menuItem.style.cursor = 'pointer';
                menuItem.style.fontSize = '14px';
                
                menuItem.addEventListener('mouseover', () => {
                    menuItem.style.backgroundColor = '#f0f0f0';
                });
                
                menuItem.addEventListener('mouseout', () => {
                    menuItem.style.backgroundColor = '';
                });
                
                menuItem.addEventListener('click', () => {
                    item.action();
                    contextMenu.style.display = 'none';
                });
                
                contextMenu.appendChild(menuItem);
            });
            document.body.appendChild(contextMenu);
            textLayer.addEventListener('contextmenu', function(e) {
                if (e.target.classList.contains('editable-element')) {
                    e.preventDefault();
                    contextMenu.style.left = `${e.pageX}px`;
                    contextMenu.style.top = `${e.pageY}px`;
                    contextMenu.style.display = 'block';
                }
            });
            document.addEventListener('click', function() {
                contextMenu.style.display = 'none';
            });
        }
        function initFontSizeAdjustment() {
            addFontSizeAdjustment();
            modifyTextElementCreation();
            addFontSizeKeyboardShortcuts();
            addFontContextMenu();
        }
        function onPrevPage() {
            if (pdfDoc === null || pageNum <= 1) return;
            pageNum--;
            queueRenderPage(pageNum);
        }

        function onNextPage() {
            if (pdfDoc === null || pageNum >= pdfDoc.numPages) return;
            pageNum++;
            queueRenderPage(pageNum);
        }

        function queueRenderPage(num) {
            if (pageRendering) {
                pageNumPending = num;
            } else {
                renderPage(num);
            }
            document.getElementById('page-num').textContent = `Page ${num} of ${pdfDoc.numPages}`;
        }

        function handleImageSelect(event) {
            const file = event.target.files[0];
            if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                
                reader.onload = function(e) {
                    addImageToEditor(e.target.result);
                };
                
                reader.readAsDataURL(file);
            }
        }

        function addImageToEditor(imgSrc) {
            const container = document.createElement('div');
            container.className = 'image-element';
            container.style.width = '200px';
            container.style.height = 'auto';
            container.style.left = '50px';
            container.style.top = '50px';
            container.style.position = 'absolute';
            
            const imgElement = document.createElement('img');
            imgElement.src = imgSrc;
            imgElement.style.width = '100%';
            imgElement.style.height = 'auto';
            imgElement.draggable = false;
            
            container.appendChild(imgElement);
            
            container.addEventListener('mousedown', function(e) {
                if (e.target === imgElement || e.target === container) {
                    let offsetX = e.clientX - parseInt(container.style.left);
                    let offsetY = e.clientY - parseInt(container.style.top);
                    
                    function moveImage(e) {
                        container.style.left = (e.clientX - offsetX) + 'px';
                        container.style.top = (e.clientY - offsetY) + 'px';
                    }
                    
                    function stopMoving() {
                        document.removeEventListener('mousemove', moveImage);
                        document.removeEventListener('mouseup', stopMoving);
                    }
                    
                    document.addEventListener('mousemove', moveImage);
                    document.addEventListener('mouseup', stopMoving);
                    
                    e.preventDefault();
                }
            });
            
const resizer = document.createElement('div');
resizer.className = 'resizer';

resizer.addEventListener('mousedown', function(e) {
    e.stopPropagation();
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = parseInt(container.style.width);
    
    function resizeImage(e) {
        const newWidth = startWidth + e.clientX - startX;
        container.style.width = newWidth + 'px';
        e.preventDefault();
    }
    
    function stopResizing() {
        document.removeEventListener('mousemove', resizeImage);
        document.removeEventListener('mouseup', stopResizing);
    }
    
    document.addEventListener('mousemove', resizeImage);
    document.addEventListener('mouseup', stopResizing);
});

container.appendChild(resizer);
textLayer.appendChild(container);
imageElements.push(container);
}

// Save the edited PDF
// Save the edited PDF
function savePDF() {
    document.getElementById('loading-spinner').style.display = 'block';
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    tempCtx.fillStyle = 'white';
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    
    tempCtx.drawImage(canvas, 0, 0);
    
    html2canvas(document.querySelector(".canvas-container"), {
        scale: 1,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        canvas: tempCanvas, 
        onclone: function(clonedDoc) {
            const clonedCanvas = clonedDoc.querySelector('#pdf-canvas');
            clonedCanvas.style.display = 'none';
        }
    }).then(canvas => {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'pt', [canvas.width, canvas.height]);
        
        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        
        pdf.save('edited-document.pdf');
        
        document.getElementById('loading-spinner').style.display = 'none';
    }).catch(error => {
        console.error('Error saving PDF:', error);
        document.getElementById('loading-spinner').style.display = 'none';
        alert('Error saving PDF: ' + error.message);
    });
}

window.addEventListener('resize', function() {
    if (pdfDoc) {
        renderPage(pageNum);
    }
});

document.addEventListener('keydown', function(e) {
    if (pdfDoc) {
        if (e.key === 'ArrowLeft' || e.key === 'p') {
            onPrevPage();
        } else if (e.key === 'ArrowRight' || e.key === 'n') {
            onNextPage();
        }
    }
});

function addTooltip(element, text) {
    element.title = text;
}

addTooltip(document.getElementById('prev-page'), 'Previous page (← Arrow)');
addTooltip(document.getElementById('next-page'), 'Next page (→ Arrow)');
addTooltip(document.getElementById('add-image'), 'Add an image to the document');
addTooltip(document.getElementById('save-pdf'), 'Save the edited document as PDF');

document.querySelector('.editor-container').addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    this.style.backgroundColor = '#f0f7ff';
});

document.querySelector('.editor-container').addEventListener('dragleave', function(e) {
    e.preventDefault();
    e.stopPropagation();
    this.style.backgroundColor = '';
});

document.querySelector('.editor-container').addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    this.style.backgroundColor = '';
    
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'application/pdf') {
        const fileReader = new FileReader();
        document.getElementById('loading-spinner').style.display = 'block';
        
        fileReader.onload = function(event) {
            const typedarray = new Uint8Array(event.target.result);
            originalPdfData = typedarray;
            loadPdfFromData(typedarray);
        };
        
        fileReader.readAsArrayBuffer(files[0]);
    }
});

textLayer.addEventListener('contextmenu', function(e) {
    if (e.target.classList.contains('editable-element')) {
        e.preventDefault();
    }
});

function setZoom(newScale) {
    if (newScale < 0.5 || newScale > 3) return; 
    
    scale = newScale;
    if (pdfDoc) {
        renderPage(pageNum);
    }
}

const zoomInBtn = document.createElement('button');
zoomInBtn.textContent = '🔍+';
zoomInBtn.addEventListener('click', function() {
    setZoom(scale + 0.25);
});
addTooltip(zoomInBtn, 'Zoom In');

const zoomOutBtn = document.createElement('button');
zoomOutBtn.textContent = '🔍-';
zoomOutBtn.addEventListener('click', function() {
    setZoom(scale - 0.25);
});
addTooltip(zoomOutBtn, 'Zoom Out');

const zoomResetBtn = document.createElement('button');
zoomResetBtn.textContent = '🔍100%';
zoomResetBtn.addEventListener('click', function() {
    setZoom(1.5); 
});
addTooltip(zoomResetBtn, 'Reset Zoom');

document.querySelector('.toolbar').insertBefore(zoomOutBtn, document.getElementById('page-info'));
document.querySelector('.toolbar').insertBefore(zoomResetBtn, document.getElementById('page-info'));
document.querySelector('.toolbar').insertBefore(zoomInBtn, document.getElementById('page-info'));

document.getElementById('pdf-container').addEventListener('wheel', function(e) {
    if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(scale + delta);
    }
});
function showNotification(message) {
    if ('Notification' in window) {
        if (Notification.permission === 'granted') {
            new Notification('PDF Editor', { body: message });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    new Notification('PDF Editor', { body: message });
                }
            });
        }
    }
}
const originalSavePDF = savePDF;
savePDF = function() {
    originalSavePDF();
    showNotification('PDF saved successfully!');
};
window.addEventListener('load', function() {
    alert('Welcome to PDF Editor! Upload a PDF file to get started.');
});