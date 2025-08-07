document.addEventListener('DOMContentLoaded', function() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const resultMessage = document.getElementById('resultMessage');

  // Click to upload
  uploadArea.addEventListener('click', () => {
    fileInput.click();
  });

  // Drag and drop functionality
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  });

  // File input change
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  function handleFile(file) {
    // Validate file type
    if (!file.name.toLowerCase().endsWith('.csv')) {
      showMessage('Please upload a CSV file.', 'error');
      return;
    }

    // Validate file size (16MB)
    if (file.size > 16 * 1024 * 1024) {
      showMessage('File size must be less than 16MB.', 'error');
      return;
    }

    uploadFile(file);
  }

  function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    // Show progress
    progressContainer.style.display = 'block';
    resultMessage.style.display = 'none';
    progressFill.style.width = '0%';
    progressText.textContent = 'Uploading file...';

    // Simulate upload progress
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress > 90) progress = 90;
      progressFill.style.width = progress + '%';
    }, 200);

    fetch('/upload', {
      method: 'POST',
      body: formData
    })
    .then(response => response.json())
    .then(data => {
      clearInterval(progressInterval);
      progressFill.style.width = '100%';
      
      if (data.success) {
        progressText.textContent = 'Processing complete!';
        showMessage(
          `${data.message} <br><br>
          <a href="${data.downloadUrl}" class="download-btn">📥 Download Results</a>`,
          'success'
        );
      } else {
        progressText.textContent = 'Processing failed';
        showMessage(data.error || 'An error occurred while processing the file.', 'error');
      }
      
      // Hide progress after delay
      setTimeout(() => {
        progressContainer.style.display = 'none';
      }, 2000);
    })
    .catch(error => {
      clearInterval(progressInterval);
      progressContainer.style.display = 'none';
      console.error('Upload error:', error);
      showMessage('An error occurred while uploading the file. Please try again.', 'error');
    });
  }

  function showMessage(message, type) {
    resultMessage.innerHTML = message;
    resultMessage.className = `result-message ${type}`;
    resultMessage.style.display = 'block';
    
    // Scroll to message
    resultMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});
