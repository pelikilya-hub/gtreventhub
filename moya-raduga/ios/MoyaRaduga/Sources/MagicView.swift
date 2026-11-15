import SwiftUI

/// «Чудо-мастерская»: описал словами — получил маску, стикер или раскраску.
struct MagicView: View {
    @EnvironmentObject private var client: RadugaClient
    @EnvironmentObject private var app: AppState

    @State private var kind: MagicKind = .mask
    @State private var wish = ""
    @State private var busy = false
    @State private var result: String?
    @State private var resultKind: MagicKind = .mask
    @State private var left: Int?
    @State private var note: String?
    @FocusState private var typing: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                HStack {
                    Text("Чудо-мастерская").font(.hand(28)).foregroundStyle(Ink.ink)
                    Spacer()
                    if let left {
                        Text("чудес сегодня: \(left)").font(.text(13, bold: true)).foregroundStyle(Ink.ink)
                    }
                }

                HStack(spacing: 8) {
                    ForEach(MagicKind.allCases) { option in
                        Button(option.title) { kind = option }
                            .buttonStyle(StickerButtonStyle(fill: kind == option ? Ink.lilac : .white, radius: 22))
                            .frame(maxWidth: .infinity)
                            .accessibilityAddTraits(kind == option ? .isSelected : [])
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Что наколдовать?").font(.text(13, bold: true)).foregroundStyle(Ink.ink.opacity(0.8))
                    TextField("Дракон с радужными крыльями", text: $wish, axis: .vertical)
                        .lineLimit(2...4)
                        .font(.hand(24))
                        .foregroundStyle(Ink.ink)
                        .focused($typing)
                    Button(busy ? "Колдую…" : "Наколдовать", action: conjure)
                        .buttonStyle(StickerButtonStyle())
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .disabled(busy || wish.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
                }
                .padding(14)
                .sticker(.white, shadow: Ink.violet, radius: 20)

                if let note {
                    Text(note)
                        .font(.text(15, bold: true))
                        .foregroundStyle(Ink.ink)
                        .multilineTextAlignment(.center)
                        .padding(12)
                        .frame(maxWidth: .infinity)
                        .sticker(Ink.cream, radius: 16)
                }

                if busy {
                    ProgressView().controlSize(.large).padding(30)
                    Text("Рисую, это недолго…").font(.text(14)).foregroundStyle(Ink.ink)
                }

                if let result, !busy {
                    RemoteImage(media: result)
                        .padding(10)
                        .sticker(resultKind == .coloring ? .white : Ink.sky, radius: 20)
                    HStack(spacing: 10) {
                        Button("В чат") {
                            client.sendMedia(result, kind: resultKind == .mask ? "mask" : "sticker", text: wish)
                            app.tab = .chat
                        }
                        .buttonStyle(StickerButtonStyle())
                        if resultKind != .coloring {
                            Button("Примерить") { app.tryOn(result) }
                                .buttonStyle(StickerButtonStyle(fill: Ink.lilac))
                        }
                        Button("В комнату") {
                            Task {
                                if let image = await client.image(result) { app.room = RoomItem(image: image) }
                            }
                        }
                        .buttonStyle(StickerButtonStyle(fill: .white))
                    }
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func conjure() {
        let prompt = wish.trimmingCharacters(in: .whitespacesAndNewlines)
        typing = false
        busy = true
        note = nil
        let asked = kind
        Task {
            do {
                let made = try await client.magic(kind: asked, prompt: prompt)
                result = made.media
                resultKind = asked
                left = made.left
            } catch RadugaError.server(let code) {
                note = Self.explain(code)
                if code == "limit" { left = 0 }
            } catch {
                note = "Нет связи. Попробуй ещё раз"
            }
            busy = false
        }
    }

    private static func explain(_ code: String) -> String {
        switch code {
        case "limit": return "На сегодня чудеса закончились. Завтра будут новые!"
        case "unkind": return "Такое я рисовать не умею. Придумай что-нибудь доброе"
        case "magic_off": return "Мастерская пока закрыта — попроси взрослого её включить"
        default: return "Не получилось. Попробуй ещё раз"
        }
    }
}
