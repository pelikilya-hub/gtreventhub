import SwiftUI

struct ChatView: View {
    @EnvironmentObject private var client: RadugaClient
    @EnvironmentObject private var app: AppState
    @State private var draft = ""
    @State private var lastTyping = Date.distantPast
    @State private var opened: ChatMessage?
    @State private var confirmLogout = false

    var body: some View {
        VStack(spacing: 0) {
            header
            people
            messages
            composer
        }
        .sheet(item: $opened) { message in
            PictureSheet(message: message)
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Моя радуга").font(.hand(34)).foregroundStyle(Ink.ink)
                Scribble().frame(width: 170, height: 16)
            }
            .onLongPressGesture { confirmLogout = true }
            Spacer()
            Text(badge)
                .font(.text(13, bold: true))
                .foregroundStyle(Ink.ink)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .sticker(client.status == .online ? Ink.yellow : .white, radius: 14, offset: 3)
                .rotationEffect(.degrees(3))
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .confirmationDialog("Выйти из «Моей радуги»?", isPresented: $confirmLogout) {
            Button("Выйти", role: .destructive) { client.logout() }
        }
    }

    private var badge: String {
        switch client.status {
        case .online: return "\(client.online.count) из \(client.members.count) тут"
        case .offline: return "нет связи…"
        default: return "захожу…"
        }
    }

    private var people: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(Array(client.members.enumerated()), id: \.element.id) { index, member in
                    VStack(spacing: 4) {
                        Avatar(member: member, dimmed: !client.online.contains(member.id))
                            .rotationEffect(.degrees(index.isMultiple(of: 2) ? -3 : 3))
                        Text(member.name).font(.text(11, bold: member.owner == true)).foregroundStyle(Ink.ink)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(member.name), \(client.online.contains(member.id) ? "в сети" : "не в сети")")
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
        }
    }

    private var messages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 16) {
                    ForEach(client.messages) { message in
                        Bubble(message: message, mine: message.member == client.me?.id) { opened = message }
                            .id(message.id)
                    }
                    TimelineView(.periodic(from: .now, by: 1)) { timeline in
                        let names = client.typing
                            .filter { timeline.date.timeIntervalSince($0.value) < 4 }
                            .compactMap { client.member($0.key)?.name }
                            .sorted()
                        if !names.isEmpty {
                            Text("\(names.joined(separator: ", ")) \(names.count == 1 ? "печатает" : "печатают")…")
                                .font(.text(13)).foregroundStyle(Ink.ink.opacity(0.75))
                        }
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 20)
                .padding(.top, 6)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: client.messages.count) { _, _ in
                withAnimation { proxy.scrollTo("end", anchor: .bottom) }
            }
            .onAppear { proxy.scrollTo("end", anchor: .bottom) }
        }
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("Напиши что-нибудь…", text: $draft, axis: .vertical)
                .lineLimit(1...4)
                .font(.text(16))
                .foregroundStyle(Ink.ink)
                .padding(.horizontal, 14).padding(.vertical, 12)
                .sticker(.white, offset: 0)
                .onChange(of: draft) { _, _ in
                    guard Date().timeIntervalSince(lastTyping) > 2 else { return }
                    lastTyping = Date()
                    client.sendTyping()
                }
            Button(action: send) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .sticker(Ink.deepBlue, offset: 3)
            }
            .accessibilityLabel("Отправить")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        client.sendText(text)
        draft = ""
    }
}

private struct Bubble: View {
    @EnvironmentObject private var client: RadugaClient
    let message: ChatMessage
    let mine: Bool
    let open: () -> Void

    private var author: Member? { client.member(message.member) }
    private var tint: Color { Color(hexString: author?.color ?? "#22223B") }

    private var caption: String {
        let name = author?.name ?? "Кто-то"
        switch message.kind {
        case "drawing": return "\(name) · рисунок"
        case "mask": return "\(name) · маска"
        case "image": return "\(name) · фото"
        case "sticker": return "\(name) · чудо"
        default: return author?.owner == true ? "\(name), хозяйка радуги" : name
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !mine {
                Text(caption).font(.text(12, bold: true)).foregroundStyle(Ink.ink.opacity(0.8))
            }
            if let media = message.media {
                Button(action: open) {
                    RemoteImage(media: media)
                        .frame(maxWidth: 220, maxHeight: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .accessibilityLabel("Открыть картинку")
            }
            if let text = message.text, !text.isEmpty {
                Text(text)
                    .font(author?.owner == true && !mine ? .hand(22) : .text(16))
                    .foregroundStyle(Ink.ink)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .sticker(mine ? Ink.sky : (author?.owner == true ? Ink.cream : .white), shadow: mine ? Ink.blue : tint, radius: 18)
        .rotationEffect(.degrees(Double(message.id % 3 - 1) * 1.2))
        .frame(maxWidth: 290, alignment: mine ? .trailing : .leading)
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
    }
}

/// Картинка из чата крупно: примерить как маску или поставить в комнате.
private struct PictureSheet: View {
    @EnvironmentObject private var client: RadugaClient
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    let message: ChatMessage

    var body: some View {
        VStack(spacing: 18) {
            if let media = message.media {
                RemoteImage(media: media)
                    .padding(10)
                    .sticker(.white, radius: 20)
                    .padding(.horizontal, 20)
                HStack(spacing: 12) {
                    Button("В комнату") {
                        Task {
                            guard let image = await client.image(media) else { return }
                            dismiss()
                            app.room = RoomItem(image: image)
                        }
                    }
                    .buttonStyle(StickerButtonStyle())
                    if message.kind == "sticker" || message.kind == "mask" {
                        Button("Примерить") {
                            dismiss()
                            app.tryOn(media)
                        }
                        .buttonStyle(StickerButtonStyle(fill: Ink.lilac))
                    }
                }
            }
            Button("Закрыть") { dismiss() }
                .buttonStyle(StickerButtonStyle(fill: .white))
        }
        .padding(.vertical, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Paper())
    }
}

/// Две волнистые черты под названием.
struct Scribble: View {
    var body: some View {
        Canvas { context, size in
            for (i, color) in [Ink.red, Ink.blue].enumerated() {
                let y = 5 + CGFloat(i) * 6
                var line = Path()
                line.move(to: CGPoint(x: 3, y: y))
                line.addCurve(to: CGPoint(x: size.width - 3, y: y),
                              control1: CGPoint(x: size.width * 0.35, y: y - 6),
                              control2: CGPoint(x: size.width * 0.6, y: y + 6))
                context.stroke(line, with: .color(color), style: StrokeStyle(lineWidth: 4, lineCap: .round))
            }
        }
        .accessibilityHidden(true)
    }
}
