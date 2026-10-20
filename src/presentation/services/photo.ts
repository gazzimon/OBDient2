// A photo for the assistant (M3.5): from the camera or the gallery, longest
// side at most 1024 px, JPEG, as a data URL the model accepts. A dashboard
// warning light reads fine at that size and the request stays ~150 kB.

import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.7;

export interface Photo {
  readonly uri: string; // local, for the thumbnail
  readonly dataUrl: string; // what the model gets
}

export type PhotoSource = 'camera' | 'library';

// null when the user backs out or denies the camera.
export async function pickPhoto(source: PhotoSource): Promise<Photo | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 1 };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;

  return photoFrom(asset.uri, asset.width, asset.height);
}

// A picture (picker or the dashboard camera) made ready for the model: at most
// MAX_SIDE on its long side, JPEG, and as a data URL.
export async function photoFrom(uri: string, width: number, height: number): Promise<Photo | null> {
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  // Only shrink: resize() with one side keeps the ratio, and would also enlarge.
  if (Math.max(width, height) > MAX_SIDE) {
    context.resize(width >= height ? { width: MAX_SIDE, height: null } : { width: null, height: MAX_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
  if (!saved.base64) return null;
  return { uri: saved.uri, dataUrl: `data:image/jpeg;base64,${saved.base64}` };
}
