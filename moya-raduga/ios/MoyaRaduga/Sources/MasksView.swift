import ARKit
import SceneKit
import SwiftUI

/// Маска — картинка на прозрачном фоне, которая «висит» перед лицом.
struct MaskItem: Identifiable, Hashable {
    enum Source: Hashable {
        case builtin(String) // имя файла в приложении
        case remote(String)  // наколдованная, ключ картинки на сервере
    }

    let id: String
    let title: String
    let source: Source
    var hint: String?

    /// Свои маски нарисованы на листе 32 см вокруг лица (см. tools/make-assets.mjs),
    /// наколдованные — просто картинка лица, поэтому меньше и чуть ближе к камере.
    var size: CGFloat {
        if case .builtin = source { return 0.32 }
        return 0.21
    }

    var offset: SCNVector3 {
        if case .builtin = source { return SCNVector3(0, 0, 0.05) }
        return SCNVector3(0, 0.012, 0.075)
    }

    static let builtin: [MaskItem] = [
        MaskItem(id: "cat", title: "Котик", source: .builtin("mask-cat.png"), hint: "Мяу!"),
        MaskItem(id: "stars", title: "Звёзды", source: .builtin("mask-stars.png"), hint: "Вау!"),
        MaskItem(id: "crown", title: "Корона", source: .builtin("mask-crown.png"), hint: "Ура!"),
        MaskItem(id: "unicorn", title: "Единорог", source: .builtin("mask-unicorn.png"), hint: "И-го-го!"),
        MaskItem(id: "frog", title: "Квакша", source: .builtin("mask-frog.png"), hint: "Ква!"),
    ]
}

/// Даёт экрану сделать снимок того, что видит камера вместе с маской.
final class Shutter {
    weak var view: ARSCNView?
    func snap() -> UIImage? { view?.snapshot() }
}

struct FaceCamera: UIViewRepresentable {
    let image: UIImage?
    let size: CGFloat
    let offset: SCNVector3
    let shutter: Shutter
    @Binding var mouthOpen: Bool

    func makeCoordinator() -> Coordinator { Coordinator(mouthOpen: $mouthOpen) }

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.delegate = context.coordinator
        view.automaticallyUpdatesLighting = true
        shutter.view = view
        if ARFaceTrackingConfiguration.isSupported {
            view.session.run(ARFaceTrackingConfiguration(), options: [.resetTracking, .removeExistingAnchors])
        }
        return view
    }

    func updateUIView(_ view: ARSCNView, context: Context) {
        context.coordinator.wear(image, size: size, offset: offset)
    }

    static func dismantleUIView(_ view: ARSCNView, coordinator: Coordinator) {
        view.session.pause()
    }

    final class Coordinator: NSObject, ARSCNViewDelegate {
        private let plane = SCNPlane(width: 0.32, height: 0.32)
        private let mask: SCNNode
        private var mouthOpen: Binding<Bool>
        private var wasOpen = false

        init(mouthOpen: Binding<Bool>) {
            self.mouthOpen = mouthOpen
            let material = SCNMaterial()
            material.lightingModel = .constant
            material.isDoubleSided = true
            material.diffuse.contents = UIColor.clear
            plane.materials = [material]
            mask = SCNNode(geometry: plane)
            super.init()
        }

        func wear(_ image: UIImage?, size: CGFloat, offset: SCNVector3) {
            plane.firstMaterial?.diffuse.contents = image ?? UIColor.clear
            plane.width = size
            plane.height = size
            mask.position = offset
        }

        func renderer(_ renderer: SCNSceneRenderer, nodeFor anchor: ARAnchor) -> SCNNode? {
            guard anchor is ARFaceAnchor else { return nil }
            let node = SCNNode()
            node.addChildNode(mask)
            return node
        }

        func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
            guard let face = anchor as? ARFaceAnchor else { return }
            let open = (face.blendShapes[.jawOpen]?.floatValue ?? 0) > 0.45
            guard open != wasOpen else { return }
            wasOpen = open
            DispatchQueue.main.async { self.mouthOpen.wrappedValue = open }
        }
    }
}

struct MasksView: View {
    @EnvironmentObject private var client: RadugaClient
    @EnvironmentObject private var app: AppState

    @State private var selected = MaskItem.builtin[0]
    @State private var image: UIImage?
    @State private var mouthOpen = false
    @State private var sending = false
    @State private var shutter = Shutter()

    private var masks: [MaskItem] {
        app.myMasks.map { MaskItem(id: $0, title: "Моя", source: .remote($0), hint: nil) } + MaskItem.builtin
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Маски").font(.hand(28)).foregroundStyle(Ink.ink)
                Spacer()
                Button("Придумать свою") { app.tab = .magic }
                    .buttonStyle(StickerButtonStyle(fill: Ink.lilac))
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)

            camera
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Ink.ink, lineWidth: 2.5))
                .background(RoundedRectangle(cornerRadius: 20).fill(Ink.ink).offset(x: 5, y: 5))
                .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(masks) { mask in
                        Button {
                            selected = mask
                        } label: {
                            VStack(spacing: 4) {
                                MaskThumb(mask: mask)
                                    .frame(width: 60, height: 60)
                                    .sticker(selected == mask ? Ink.yellow : .white, radius: 18, offset: selected == mask ? 4 : 2)
                                Text(mask.title).font(.text(12, bold: selected == mask)).foregroundStyle(Ink.ink)
                            }
                        }
                        .accessibilityLabel("Маска \(mask.title)")
                        .accessibilityAddTraits(selected == mask ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }

            Button(sending ? "Отправляю…" : "Щёлк — и в чат", action: shoot)
                .buttonStyle(StickerButtonStyle(fill: Ink.sky, radius: 24))
                .disabled(sending || !ARFaceTrackingConfiguration.isSupported)
                .padding(.bottom, 8)
        }
        .task(id: selected) { await load(selected) }
        .onAppear(perform: wearRequested)
        .onChange(of: app.wear) { _, _ in wearRequested() }
    }

    @ViewBuilder private var camera: some View {
        if ARFaceTrackingConfiguration.isSupported {
            FaceCamera(image: image, size: selected.size, offset: selected.offset, shutter: shutter, mouthOpen: $mouthOpen)
                .overlay(alignment: .bottom) {
                    if mouthOpen, let hint = selected.hint {
                        Text(hint)
                            .font(.hand(30))
                            .foregroundStyle(Ink.ink)
                            .padding(.horizontal, 18).padding(.vertical, 6)
                            .sticker(Ink.yellow, radius: 18)
                            .padding(.bottom, 18)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                .animation(.spring(duration: 0.25), value: mouthOpen)
        } else {
            VStack(spacing: 10) {
                Image(systemName: "face.dashed").font(.system(size: 54)).foregroundStyle(Ink.ink)
                Text("Маски работают на iPhone с Face ID")
                    .font(.text(16, bold: true)).foregroundStyle(Ink.ink)
                    .multilineTextAlignment(.center)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Ink.sky)
        }
    }

    private func wearRequested() {
        guard let media = app.wear else { return }
        app.wear = nil
        selected = MaskItem(id: media, title: "Моя", source: .remote(media), hint: nil)
    }

    private func load(_ mask: MaskItem) async {
        switch mask.source {
        case .builtin(let file): image = UIImage(named: file)
        case .remote(let media): image = await client.image(media)
        }
    }

    private func shoot() {
        guard let photo = shutter.snap()?.jpegData(compressionQuality: 0.8) else { return }
        sending = true
        Task {
            if let media = try? await client.upload(photo, mime: "image/jpeg") {
                client.sendMedia(media, kind: "image")
                app.tab = .chat
            }
            sending = false
        }
    }
}

private struct MaskThumb: View {
    let mask: MaskItem

    var body: some View {
        switch mask.source {
        case .builtin(let file):
            if let image = UIImage(named: file) {
                Image(uiImage: image).resizable().scaledToFit().padding(4)
            }
        case .remote(let media):
            RemoteImage(media: media).padding(6)
        }
    }
}
