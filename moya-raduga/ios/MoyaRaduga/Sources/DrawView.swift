import SwiftUI

/// Рисует штрихи на листе любого размера: координаты хранятся в долях.
struct BoardCanvas: View {
    let strokes: [Stroke]

    var body: some View {
        Canvas { context, size in
            for stroke in strokes {
                let points = stroke.points.compactMap { p in
                    p.count == 2 ? CGPoint(x: CGFloat(p[0]) * size.width, y: CGFloat(p[1]) * size.height) : nil
                }
                guard let first = points.first else { continue }
                let width = max(CGFloat(stroke.width) * size.width, 1)
                let color = Color(hexString: stroke.color)
                if points.count == 1 {
                    context.fill(Path(ellipseIn: CGRect(x: first.x - width / 2, y: first.y - width / 2, width: width, height: width)), with: .color(color))
                } else {
                    var path = Path()
                    path.move(to: first)
                    for point in points.dropFirst() { path.addLine(to: point) }
                    context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
                }
            }
        }
    }
}

struct DrawView: View {
    @EnvironmentObject private var client: RadugaClient
    @EnvironmentObject private var app: AppState

    private static let widths: [Double] = [0.008, 0.02, 0.045]
    private static let eraser = "#FFFFFF"

    @State private var color = Ink.markers[4]
    @State private var width = widths[1]
    @State private var current: Stroke?
    @State private var lastSent = Date.distantPast
    @State private var sending = false
    @State private var confirmClear = false

    private var everything: [Stroke] {
        var all = client.strokes
        all.append(contentsOf: liveStrokes)
        if let current { all.append(current) }
        return all
    }

    private var artists: String {
        let names = Set(client.live.values.compactMap { client.member($0.member)?.name }).sorted()
        return names.isEmpty ? "общий лист — рисуйте вместе" : "рисуют прямо сейчас: \(names.joined(separator: ", "))"
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Поляна").font(.hand(28)).foregroundStyle(Ink.ink)
                    Text(artists).font(.text(12, bold: true)).foregroundStyle(Color(hex: 0x136B39))
                }
                Spacer()
                Button(sending ? "Несу…" : "В чат", action: share)
                    .buttonStyle(StickerButtonStyle())
                    .disabled(sending || client.strokes.isEmpty)
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)

            board
                .padding(.horizontal, 16)

            HStack(spacing: 10) {
                ForEach(Self.widths, id: \.self) { w in dot(w) }
                Spacer()
                tool("arrow.uturn.backward", "Отменить мой штрих") { client.undoLast() }
                tool("eraser", "Ластик", active: color == Self.eraser) { color = Self.eraser }
                tool("cube.transparent", "Поставить рисунок в комнате") {
                    if let image = snapshot() { app.room = RoomItem(image: image) }
                }
                if client.me?.owner == true {
                    tool("trash", "Чистый лист") { confirmClear = true }
                }
            }
            .padding(.horizontal, 16)

            HStack(alignment: .bottom, spacing: 8) {
                ForEach(Ink.markers, id: \.self) { marker in pen(marker) }
            }
            .frame(height: 74, alignment: .bottom)
            .animation(.spring(duration: 0.2), value: color)
        }
        .confirmationDialog("Стереть весь рисунок у всех?", isPresented: $confirmClear) {
            Button("Чистый лист", role: .destructive) { client.clearBoard() }
        }
    }

    private var board: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Color.white
                BoardCanvas(strokes: everything)
                // Подпись у «пера» каждого, кто рисует сейчас.
                ForEach(liveStrokes) { stroke in
                    nameTag(for: stroke, in: geo.size)
                }
            }
            .contentShape(Rectangle())
            .gesture(drawing(in: geo.size))
        }
        .aspectRatio(3 / 4, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Ink.ink, lineWidth: 2.5))
        .background(RoundedRectangle(cornerRadius: 20).fill(Ink.ink).offset(x: 5, y: 5))
        .accessibilityLabel("Общий лист для рисования")
    }

    private var liveStrokes: [Stroke] {
        client.live.values.sorted { $0.id < $1.id }
    }

    @ViewBuilder
    private func nameTag(for stroke: Stroke, in size: CGSize) -> some View {
        if let last = stroke.points.last, last.count == 2, let member = client.member(stroke.member) {
            let x = CGFloat(last[0]) * size.width + 26
            let y = CGFloat(last[1]) * size.height - 16
            Text(member.name)
                .font(.text(12, bold: true))
                .foregroundStyle(Ink.ink)
                .padding(.horizontal, 8).padding(.vertical, 2)
                .background(Capsule().fill(Color(hexString: member.color)))
                .overlay(Capsule().strokeBorder(Ink.ink, lineWidth: 2))
                .position(x: x, y: y)
        }
    }

    private func drawing(in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in moved(to: value.location, in: size) }
            .onEnded { _ in lifted() }
    }

    private func newStroke(at point: [Double]) -> Stroke {
        Stroke(id: UUID().uuidString, member: client.me?.id, color: color, width: width, points: [point])
    }

    private func moved(to location: CGPoint, in size: CGSize) {
        guard size.width > 0, size.height > 0 else { return }
        let x = Double(min(max(location.x / size.width, 0), 1))
        let y = Double(min(max(location.y / size.height, 0), 1))
        let point = [x, y]
        guard var stroke = current else {
            current = newStroke(at: point)
            return
        }
        stroke.points.append(point)
        current = stroke
        // Очень длинную линию режем на части: у сервера предел точек на штрих.
        if stroke.points.count >= 1500 {
            client.commit(stroke)
            current = newStroke(at: point)
        } else if Date().timeIntervalSince(lastSent) > 0.06 {
            lastSent = Date()
            client.sendDraw(stroke)
        }
    }

    private func pen(_ marker: String) -> some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: 14, topTrailingRadius: 14)
        let chosen = color == marker
        return Button {
            color = marker
        } label: {
            shape.fill(Color(hexString: marker))
                .overlay(shape.strokeBorder(Ink.ink, lineWidth: 2.5))
                .frame(width: 40, height: chosen ? 74 : 54)
        }
        .accessibilityLabel("Фломастер")
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }

    private func lifted() {
        if let stroke = current { client.commit(stroke) }
        current = nil
    }

    private func dot(_ w: Double) -> some View {
        let side = CGFloat(8 + w * 400)
        let chosen = width == w
        let label = w == Self.widths[0] ? "Тонкая линия" : (w == Self.widths[1] ? "Средняя линия" : "Толстая линия")
        return Button {
            width = w
        } label: {
            Circle().fill(Ink.ink)
                .frame(width: side, height: side)
                .frame(width: 44, height: 44)
                .background(Circle().fill(chosen ? Ink.yellow : Color.clear))
                .overlay(Circle().strokeBorder(chosen ? Ink.ink : Color.clear, lineWidth: 2.5))
        }
        .accessibilityLabel(label)
    }

    private func tool(_ symbol: String, _ label: String, active: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Ink.ink)
                .frame(width: 44, height: 44)
                .sticker(active ? Ink.yellow : .white, radius: 12, offset: 2)
        }
        .accessibilityLabel(label)
    }

    private func snapshot() -> UIImage? {
        let renderer = ImageRenderer(content: BoardCanvas(strokes: client.strokes).frame(width: 900, height: 1200).background(Color.white))
        renderer.scale = 1
        return renderer.uiImage
    }

    private func share() {
        guard let data = snapshot()?.pngData() else { return }
        sending = true
        Task {
            if let media = try? await client.upload(data, mime: "image/png") {
                client.sendMedia(media, kind: "drawing")
                app.tab = .chat
            }
            sending = false
        }
    }
}
