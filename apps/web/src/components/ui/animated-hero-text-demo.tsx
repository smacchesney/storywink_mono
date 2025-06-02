"use client";

import { AnimatedHeroText, type RotatingItem } from "@/components/ui/animated-hero-text";

function AnimatedHeroTextDemo() {
  // Example rotating items with images (you would use your actual mascot images)
  const heroItemsWithImages: RotatingItem[] = [
    {
      word: "Hero",
      image: {
        src: "/images/mascot-hero.png", // Your mascot in hero pose
        alt: "Mascot as Hero",
      }
    },
    {
      word: "Princess", 
      image: {
        src: "/images/mascot-princess.png", // Your mascot in princess pose
        alt: "Mascot as Princess",
      }
    },
    {
      word: "Adventurer",
      image: {
        src: "/images/mascot-adventurer.png", // Your mascot in adventurer pose
        alt: "Mascot as Adventurer",
      }
    },
    {
      word: "Explorer",
      image: {
        src: "/images/mascot-explorer.png", // Your mascot in explorer pose
        alt: "Mascot as Explorer",
      }
    },
    {
      word: "Firefighter",
      image: {
        src: "/images/mascot-firefighter.png", // Your mascot in firefighter pose
        alt: "Mascot as Firefighter",
      }
    }
  ];

  return (
    <div className="space-y-12 p-8">
      {/* Text Only (Current Usage) */}
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-4 text-slate-700">Text Only (Current)</h2>
        <AnimatedHeroText />
      </div>

      {/* With Images Above */}
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-4 text-slate-700">With Images Above</h2>
        <AnimatedHeroText 
          rotatingItems={heroItemsWithImages}
          imagePosition="above"
          imageSize="md"
        />
      </div>

      {/* With Images Below */}
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-4 text-slate-700">With Images Below</h2>
        <AnimatedHeroText 
          rotatingItems={heroItemsWithImages}
          imagePosition="below"
          imageSize="lg"
        />
      </div>

      {/* With Images Left */}
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-4 text-slate-700">With Images Left</h2>
        <AnimatedHeroText 
          rotatingItems={heroItemsWithImages}
          imagePosition="left"
          imageSize="sm"
        />
      </div>

      {/* Mixed - Some with Images, Some Without */}
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-4 text-slate-700">Mixed Content</h2>
        <AnimatedHeroText 
          rotatingItems={[
            { word: "Hero", image: { src: "/images/mascot-hero.png", alt: "Hero" } },
            { word: "Princess" }, // No image
            { word: "Adventurer", image: { src: "/images/mascot-adventurer.png", alt: "Adventurer" } },
            { word: "Explorer" }, // No image
          ]}
          imagePosition="above"
        />
      </div>

      {/* Usage Instructions */}
      <div className="bg-slate-50 p-6 rounded-lg">
        <h3 className="text-lg font-semibold mb-3">How to Use with Images:</h3>
        <div className="space-y-2 text-sm text-slate-600">
          <p><strong>1. Create your mascot images:</strong> Save different poses of your mascot (hero, princess, etc.) in your public/images folder</p>
          <p><strong>2. Use rotatingItems prop:</strong> Instead of just words, provide objects with both word and image</p>
          <p><strong>3. Position options:</strong> 'above', 'below', 'left', or 'right' relative to the text</p>
          <p><strong>4. Size options:</strong> 'sm' (48-64px), 'md' (64-96px), or 'lg' (80-128px)</p>
          <p><strong>5. Mixed content:</strong> Some items can have images while others are text-only</p>
        </div>
      </div>
    </div>
  );
}

export { AnimatedHeroTextDemo }; 