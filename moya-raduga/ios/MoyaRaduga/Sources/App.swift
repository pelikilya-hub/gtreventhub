import SwiftUI

@main
struct MoyaRadugaApp: App {
    @StateObject private var client = RadugaClient()
    @StateObject private var app = AppState()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            Group {
                if client.status == .loggedOut {
                    LoginView()
                } else {
                    MainView()
                }
            }
            .environmentObject(client)
            .environmentObject(app)
            .preferredColorScheme(.light)
            .onChange(of: phase) { _, now in
                if now == .active { client.connect() }
            }
        }
    }
}

enum Tab: String, CaseIterable {
    case chat = "Чат", draw = "Рисовать", masks = "Маски", magic = "Чудо"
}

/// Картинка, которую сейчас ставят в комнату.
struct RoomItem: Identifiable {
    let id = UUID()
    let image: UIImage
}

/// То, что связывает экраны между собой: вкладка, «примерить маску», «поставить в комнате».
@MainActor
final class AppState: ObservableObject {
    @Published var tab: Tab = .chat
    @Published var room: RoomItem?
    /// Ключ наколдованной маски, которую надо надеть при открытии вкладки «Маски».
    @Published var wear: String?
    /// Свои наколдованные маски (ключи картинок) — помним между запусками.
    @Published var myMasks: [String] = UserDefaults.standard.stringArray(forKey: "myMasks") ?? [] {
        didSet { UserDefaults.standard.set(myMasks, forKey: "myMasks") }
    }

    func tryOn(_ media: String) {
        if !myMasks.contains(media) { myMasks.insert(media, at: 0) }
        wear = media
        tab = .masks
    }
}

struct MainView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        VStack(spacing: 0) {
            Group {
                switch app.tab {
                case .chat: ChatView()
                case .draw: DrawView()
                case .masks: MasksView()
                case .magic: MagicView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            HStack(spacing: 6) {
                ForEach(Tab.allCases, id: \.self) { tab in
                    Button {
                        app.tab = tab
                    } label: {
                        Text(tab.rawValue)
                            .font(.text(13, bold: true))
                            .foregroundStyle(Ink.ink)
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .background(
                                RoundedRectangle(cornerRadius: 14)
                                    .fill(app.tab == tab ? Ink.yellow : .clear)
                                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(app.tab == tab ? Ink.ink : .clear, lineWidth: 2.5))
                            )
                    }
                    .accessibilityAddTraits(app.tab == tab ? .isSelected : [])
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 4)
            .background(Color.white.ignoresSafeArea(edges: .bottom))
            .overlay(alignment: .top) { Rectangle().fill(Ink.ink).frame(height: 2.5) }
        }
        .background(Paper())
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .fullScreenCover(item: $app.room) { item in
            RoomView(image: item.image)
        }
    }
}

/// Картинка с сервера (нужен код входа, поэтому не AsyncImage).
struct RemoteImage: View {
    @EnvironmentObject private var client: RadugaClient
    let media: String
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .task(id: media) { image = await client.image(media) }
    }
}
