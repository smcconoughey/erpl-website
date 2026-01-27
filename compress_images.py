#!/usr/bin/env python3
"""
Image Compression Script for ERPL Website
Run this after adding new images: python3 compress_images.py
"""

from PIL import Image
import os
import sys

# Configuration
MAX_DIMENSION = {
    'team': 600,      # Team photos
    'projects': 1200, # Project images
    'sponsors': 400,  # Sponsor logos
    'logo': 800,      # Logos
    'hero': 1920,     # Hero images
}
JPEG_QUALITY = 85
SKIP_IF_SMALLER_THAN = 100 * 1024  # Skip files under 100KB

def get_max_dimension(path):
    """Get max dimension based on folder"""
    for folder, size in MAX_DIMENSION.items():
        if folder in path:
            return size
    return 1200  # Default

def compress_image(path):
    """Compress a single image"""
    try:
        original_size = os.path.getsize(path)
        
        # Skip small files
        if original_size < SKIP_IF_SMALLER_THAN:
            return None
            
        img = Image.open(path)
        max_dim = get_max_dimension(path)
        
        # Handle transparency
        has_transparency = img.mode == 'RGBA' and path.endswith('.png')
        
        if img.mode == 'RGBA' and not has_transparency:
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1])
            img = background
        elif img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGB')
        
        # Resize if needed
        w, h = img.size
        if max(w, h) > max_dim:
            ratio = max_dim / max(w, h)
            new_size = (int(w * ratio), int(h * ratio))
            img = img.resize(new_size, Image.LANCZOS)
        
        # Save
        if has_transparency:
            img.save(path, 'PNG', optimize=True)
        else:
            # Convert PNG to JPG if no transparency
            if path.endswith('.png'):
                new_path = path.replace('.png', '.jpg')
                if img.mode == 'RGBA':
                    img = img.convert('RGB')
                img.save(new_path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
                os.remove(path)
                new_size = os.path.getsize(new_path)
                return (path, original_size, new_path, new_size)
            else:
                img.save(path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
        
        new_size = os.path.getsize(path)
        return (path, original_size, path, new_size)
        
    except Exception as e:
        print(f"  Error: {path} - {e}")
        return None

def main():
    print("🖼️  ERPL Image Compression Tool\n")
    
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
                    
                    if old_path != new_path:
                        print(f"  ✓ {old_path} → .jpg: {old_size//1024}KB → {new_size//1024}KB")
                    else:
                        print(f"  ✓ {path}: {old_size//1024}KB → {new_size//1024}KB")
    
    if compressed_count > 0:
        print(f"\n✅ Compressed {compressed_count} images")
        print(f"💾 Total saved: {total_saved // 1024 // 1024}MB ({total_saved // 1024}KB)")
        print("\n⚠️  If any PNGs were converted to JPG, update your references!")
    else:
        print("✓ All images are already optimized!")

if __name__ == '__main__':
    main()
