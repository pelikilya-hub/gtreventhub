import ARKit
import SceneKit
import SwiftUI

/// «Рисунок в комнате»: тапни по столу или полу — картинка встанет туда и останется,
/// пока ходишь вокруг.
struct RoomView: View {
    @Environment(\.dismiss) private var dismiss
    let image: UIImage
    @State private var placed = 0

    var body: some View {
        ZStack {
            if ARWorldTrackingConfiguration.isSupported {
                RoomCamera(image: image, placed: $placed).ignoresSafeArea()
            } else {
                Paper()
                Text("На этом устройстве комната не открывается").font(.text(16, bold: true)).foregroundStyle(Ink.ink)
            }
            VStack {
                HStack {
                    Spacer()
                    Button("Готово") { dismiss() }
                        .buttonStyle(StickerButtonStyle())
                }
                Spacer()
                Text(placed == 0 ? "Наведи на стол или пол и нажми" : "Нажми ещё — поставим рядом")
                    .font(.text(15, bold: true))
                    .foregroundStyle(Ink.ink)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .sticker(.white, radius: 18)
            }
            .padding(20)
        }
    }
}

private struct RoomCamera: UIViewRepresentable {
    let image: UIImage
    @Binding var placed: Int

    func makeCoordinator() -> Coordinator { Coordinator(image: image, placed: $placed) }

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.automaticallyUpdatesLighting = true
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal]
        view.session.run(config)
        view.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tap(_:))))
        context.coordinator.view = view
        return view
    }

    func updateUIView(_ view: ARSCNView, context: Context) {}

    static func dismantleUIView(_ view: ARSCNView, coordinator: Coordinator) {
        view.session.pause()
    }

    final class Coordinator: NSObject {
        weak var view: ARSCNView?
        private let image: UIImage
        private var placed: Binding<Int>

        init(image: UIImage, placed: Binding<Int>) {
            self.image = image
            self.placed = placed
        }

        @objc func tap(_ gesture: UITapGestureRecognizer) {
            guard let view else { return }
            let point = gesture.location(in: view)
            guard let query = view.raycastQuery(from: point, allowing: .estimatedPlane, alignment: .horizontal),
                  let hit = view.session.raycast(query).first
            else { return }

            // Картинка высотой 40 см стоит на поверхности, как открытка, и поворачивается к зрителю.
            let height: CGFloat = 0.4
            let ratio = image.size.height > 0 ? image.size.width / image.size.height : 1
            let plane = SCNPlane(width: height * ratio, height: height)
            let material = SCNMaterial()
            material.lightingModel = .constant
            material.isDoubleSided = true
            material.diffuse.contents = image
            plane.materials = [material]

            let node = SCNNode(geometry: plane)
            let spot = hit.worldTransform.columns.3
            node.simdWorldPosition = SIMD3<Float>(spot.x, spot.y + Float(height) / 2, spot.z)
            let turn = SCNBillboardConstraint()
            turn.freeAxes = .Y
            node.constraints = [turn]
            node.scale = SCNVector3(0.01, 0.01, 0.01)
            view.scene.rootNode.addChildNode(node)
            node.runAction(.scale(to: 1, duration: 0.25))
            placed.wrappedValue += 1
        }
    }
}
