// Background Animation
class BackgroundAnimation {
    constructor() {
        console.log('Initializing background animation');
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.snowflakes = [];
        this.backgroundColor = 'rgba(59, 130, 246, 0.15)'; // Light blue background

        // Initialize canvas
        this.initCanvas();
        // Create initial snowflakes
        this.createSnowflakes(150);
        // Start animation
        this.animate();

        // Handle window resize
        window.addEventListener('resize', () => {
            this.initCanvas();
            this.createSnowflakes(150);
        });
    }

    initCanvas() {
        console.log('Setting up canvas');
        
        // Position canvas
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        this.canvas.style.zIndex = '-9999'; // Ensure it's behind everything
        this.canvas.style.pointerEvents = 'none';
        
        // Set canvas size to viewport size
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.canvas.width = width;
        this.canvas.height = height;
        
        // Clear any existing canvas
        const existingCanvas = document.querySelector('canvas.background-animation');
        if (existingCanvas) {
            existingCanvas.remove();
        }
        
        // Add class for easy selection
        this.canvas.classList.add('background-animation');
        
        // Insert canvas at the start of body
        document.body.insertBefore(this.canvas, document.body.firstChild);
        
        console.log('Canvas dimensions:', { width, height });
    }

    createSnowflakes(count) {
        this.snowflakes = [];
        for (let i = 0; i < count; i++) {
            this.snowflakes.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight - window.innerHeight,
                radius: Math.random() * 2 + 1,
                speed: Math.random() * 1 + 0.5,
                opacity: Math.random() * 0.5 + 0.3,
                wind: Math.random() * 0.5 - 0.25
            });
        }
    }

    updateSnowflakes() {
        const height = window.innerHeight;
        const width = window.innerWidth;

        this.snowflakes.forEach(snowflake => {
            // Update snowflake position
            snowflake.y += snowflake.speed;
            snowflake.x += snowflake.wind;

            // Wrap snowflakes around the screen
            if (snowflake.y > height) {
                snowflake.y = -10;
                snowflake.x = Math.random() * width;
            }
            
            // Wrap horizontally
            if (snowflake.x > width) {
                snowflake.x = 0;
            } else if (snowflake.x < 0) {
                snowflake.x = width;
            }
        });
    }

    draw() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Fill background
        this.ctx.fillStyle = this.backgroundColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw snowflakes
        this.snowflakes.forEach(snowflake => {
            this.ctx.beginPath();
            this.ctx.arc(
                snowflake.x,
                snowflake.y,
                snowflake.radius,
                0,
                Math.PI * 2
            );
            this.ctx.fillStyle = `rgba(255, 255, 255, ${snowflake.opacity})`;
            this.ctx.fill();
        });
    }

    animate() {
        this.updateSnowflakes();
        this.draw();
        requestAnimationFrame(() => this.animate());
    }
}

// Initialize background animation when the DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM loaded, starting animation');
        new BackgroundAnimation();
    });
} else {
    console.log('DOM already loaded, starting animation');
    new BackgroundAnimation();
}
