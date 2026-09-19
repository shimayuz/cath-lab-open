# Licenses and source notices

The MIT license at the repository root applies to original Cath Lab application code. It does not replace third-party data or dependency licenses, and does not grant access to hosted APIs, API keys, or subscription services.

## Vascular Model Repository

The research prototype includes data derived from VMR 0066_H_CORO_H / legacy 0002_0001:
https://purl.stanford.edu/dh173bw0673

- `src/simulator/vmr.json` contains derived centerline/ostial geometry.
- `public/models/vmr-coronary.glb` contains converted vessel surfaces.
- These files are subject to `public/licenses/VMR-LICENSE.txt`, **not MIT**.
- The supplied permission is for research and development. Permission for paid/commercial hosting is not established. Public availability does not remove this restriction.

Acknowledgement: The data used herein was provided in whole or in part with Federal funds from the National Library of Medicine under Grant No. R01LM013120, and the National Heart, Lung, and Blood Institute, National Institutes of Health, Department of Health and Human Services, under Contract No. HHSN268201100035C.

Reference: N.M. Wilson, A.K. Ortiz, and A.B. Johnson, “The Vascular Model Repository: A Public Resource of Medical Imaging Data and Blood Flow Simulation Results,” J. Med. Devices 7(4), 040923 (2013), https://doi.org/10.1115/1.4025983.

## Other materials

- MediaPipe WASM and model: see `public/licenses/mediapipe.txt` and Google's MediaPipe project. Model source: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- React, Three.js and Lucide: licenses in `public/licenses/`.
- Noto Sans JP: SIL Open Font License, loaded through Google Fonts by the simulator.
- TypeSafe and Stripe SDKs: upstream licenses distributed in their npm packages.
- Catheter shapes are simplified planar geometric representations. They do not include manufacturer CAD, dimensions or material properties. The original reference image is excluded from public distribution.
- The product page's vector sketch and mark are original illustrations, not images of the VMR dataset and not clinical images.

No endorsement by Stanford, NIH, Google, TypeSafe, Stripe, OpenAI or any device manufacturer is implied.
