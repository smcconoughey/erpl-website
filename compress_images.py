#!/usr/bin/env python3
"""
Image Compression Script for ERPL Website
Run this after adding new images: python3 compress_images.py
"""

from PIL import Image
import os
import sys

# Configuration - HIGHER QUALITY SETTINGS
MAX_DIMENSION = {
    'team': 1600,     # Team photos - higher res for hero backgrounds
    'projects': 1800, # Project images
    'sponsors': 600,  # Sponsor logos
    'logo': 1200,     # Logos
    'hero': 2400,     # Hero images
}
JPEG_QUALITY = 92  # Higher quality (was 85)
SKIP_IF_SMALLER_THAN = 200 * 1024  # Skip files under 200KB (was 100KB)

def get_max_dimension(path):
    """Get max dimension based on folder"""
    for folder, size in MAX_DIMENSION.items():
        if folder in path:
            return size
    return 1800  # Default - higher

def compress_image(path):
    """Compress a single image"""
    try:
        original_size = os.path.getsize(path)
        
        # Skip small files
        if original_size < SKIP_IF_SMALLER_THAN:
            return None
            
        img = Image.open(path)
        max_dim = get_max_dimension(path)
        
        # Handle transparency - keep PNGs with transparency as PNG
        has_transparency = img.mode == 'RGBA' and path.endswith('.png')
        
        if has_transparency:
            # Check if it actually uses transparency
            alpha = img.split()[-1]
            if alpha.getextrema()[0] < 255:  # Has actual transparency
                # Just resize, keep as PNG
                w, h = img.size
                if max(w, h) > max_dim:
                    ratio = max_dim / max(w, h)
                    new_size = (int(w * ratio), int(h * ratio))
                    img = img.resize(new_size, Image.LANCZOS)
                img.save(path, 'PNG', optimize=True)
                new_size = os.path.getsize(path)
                print(f"  ✓ {path}: {original_size//1024}KB → {new_size//1024}KB (PNG)")
                return (path, original_size, path, new_size)
        
        # Convert to RGB for JPEG
        if img.mode == 'RGBA':
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1])
            img = background
        elif img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Resize if too large
        w, h = img.size
        if max(w, h) > max_dim:
            ratio = max_dim / max(w, h)
            new_size = (int(w * ratio), int(h * ratio))
            img = img.resize(new_size, Image.LANCZOS)
        
        # Save as optimized JPEG with HIGH quality
        if path.endswith('.png'):
            new_path = path.replace('.png', '.jpg')
            img.save(new_path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
            os.remove(path)  # Remove old PNG
            new_file_size = os.path.getsize(new_path)
            print(f"  ✓ {path} → .jpg: {original_size//1024}KB → {new_file_size//1024}KB")
            return (path, original_size, new_path, new_file_size)
        else:
            img.save(path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
            new_file_size = os.path.getsize(path)
            print(f"  ✓ {path}: {original_size//1024}KB → {new_file_size//1024}KB")
            return (path, original_size, path, new_file_size)
        
    except Exception as e:
        print(f"  Error: {path} - {e}")
        return None

def main():
    print("🖼️  ERPL Image Compression Tool (High Quality Mode)\n")
    
    assets_dir = 'assets'
    if not os.path.exists(assets_dir):
        print("Error: assets/ folder not found. Run from project root.")
        sys.exit(1)
    
    total_saved = 0
    compressed_count = 0
    
    for root, dirs, files in os.walk(assets_dir):
        for file in files:
            if file.lower().endswith(('.png', '.jpg', '.jpeg')):
                path = os.path.join(root, file)
                result = compress_image(path)
                
                if result:
                    old_path, old_size, new_path, new_size = result
                    saved = old_size - new_size
                    total_saved += saved
                    compressed_count += 1
    
    if compressed_count > 0:
        print(f"\n✅ Compressed {compressed_count} images")
        print(f"💾 Total saved: {total_saved // 1024 // 1024}MB ({total_saved // 1024}KB)")
        print("\n⚠️  If any PNGs were converted to JPG, update your references!")
    else:
        print("✓ All images are already optimized!")

if __name__ == '__main__':
    main()
