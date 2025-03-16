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

        function createWhitePattern() {
            const patternCanvas = document.createElement('canvas');
            const patternContext = patternCanvas.getContext('2d');
            patternCanvas.width = 10;
            patternCanvas.height = 10;
            patternContext.fillStyle = 'white';
            patternContext.fillRect(0, 0, 10, 10);
            return ctx.createPattern(patternCanvas, 'repeat');
        }

        function renderPage(num) {
            pageRendering = true;
            
            document.getElementById('loading-spinner').style.display = 'block';
            
            textLayer.innerHTML = '';
            
            pdfDoc.getPage(num).then(function(page) {
                const viewport = page.getViewport({scale: scale});
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
                    const whitePattern = createWhitePattern();
                    
                    textContent.items.forEach(function(item, index) {
                        const tx = pdfjsLib.Util.transform(
                            viewport.transform,
                            item.transform
                        );
                        
                        const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
                        const width = item.width * viewport.scale;
                        
                        ctx.fillStyle = 'white';
                        ctx.fillRect(
                            tx[4] - 1, 
                            tx[5] - fontHeight - 1, 
                            width + 2, 
                            fontHeight + 4
                        );
                        
                        const div = document.createElement('div');
                        div.setAttribute('data-item-index', index);
                        div.className = 'editable-element';
                        div.contentEditable = true;
                        div.textContent = item.str;
                        
                        const angle = Math.atan2(tx[1], tx[0]);
                        
                        div.style.left = `${tx[4]}px`;
                        div.style.top = `${tx[5] - fontHeight}px`;
                        div.style.fontSize = `${fontHeight}px`;
                        div.style.fontFamily = 'Arial, sans-serif';
                        div.style.lineHeight = '1.2';
                        div.style.transform = `rotate(${angle}rad)`;
                        div.style.transformOrigin = 'left bottom';
                        div.style.minWidth = `${width}px`;
                        
                        if (fontHeight < 8) {
                            div.style.fontSize = '8px';
                        }
                        
                        textLayer.appendChild(div);
                        editableElements.push(div);
                    });
                    
                    renderTask.promise.then(function() {
                        pageRendering = false;
                        document.getElementById('loading-spinner').style.display = 'none';
                        
                        if (pageNumPending !== null) {
                            renderPage(pageNumPending);
                            pageNumPending = null;
                        }
                    });
                });
            });
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

// Add system notification when saving completes
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

// Enhance the savePDF function to show notification
const originalSavePDF = savePDF;
savePDF = function() {
    originalSavePDF();
    showNotification('PDF saved successfully!');
};

// Add welcome message
window.addEventListener('load', function() {
    alert('Welcome to PDF Editor! Upload a PDF file to get started.');
});