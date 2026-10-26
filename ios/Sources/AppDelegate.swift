import UIKit

/// Only here for the system's callbacks about background downloads (IOS-106).
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        BackgroundDownloader.shared.reconnect()
        return true
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        guard identifier == BackgroundDownloader.identifier else { return completionHandler() }
        BackgroundDownloader.shared.handleEvents(completionHandler)
    }
}
