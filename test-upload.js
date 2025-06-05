const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Test upload to API server
async function testUpload() {
  try {
    console.log('Testing upload to API server...');
    
    // Create a test form data
    const form = new FormData();
    const testImagePath = path.join(__dirname, 'apps/web/public/images/mascot/Winky the TREX.png');
    
    if (!fs.existsSync(testImagePath)) {
      console.error('Test image not found at:', testImagePath);
      return;
    }
    
    form.append('file', fs.createReadStream(testImagePath));
    
    // First, let's get a test token (you'll need to replace this with a real token)
    const testToken = 'test-token'; // Replace with actual token
    
    const response = await fetch('http://localhost:3001/api/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${testToken}`,
        ...form.getHeaders()
      },
      body: form
    });
    
    console.log('Response status:', response.status);
    const data = await response.json();
    console.log('Response data:', data);
    
  } catch (error) {
    console.error('Upload test failed:', error);
  }
}

// Wait a bit for servers to start, then test
setTimeout(testUpload, 5000);