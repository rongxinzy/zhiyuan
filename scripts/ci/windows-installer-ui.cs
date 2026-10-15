// Real HWND inspection/interaction for the packaged NSIS acceptance gate.
// No installer test hooks, generated screenshots, or hidden Next-button clicks.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace ZhiYuan.Acceptance {
  public sealed class WindowInfo {
    public long Handle;
    public long OwnerHandle;
    public int ProcessId;
    public int ControlId;
    public string ClassName;
    public string Text;
    public bool Visible;
    public bool Enabled;
    public int Left;
    public int Top;
    public int Width;
    public int Height;
    public uint Dpi;
  }

  public sealed class ButtonClickReceipt {
    public long DialogHandle, ButtonHandle, ActiveBefore, ActiveAtClick, ForegroundBefore, ForegroundAtClick;
    public int ProcessId, ControlId;
    public string Text;
  }

  public static class InstallerUi {
    [StructLayout(LayoutKind.Sequential)] private struct Rect {
      public int Left, Top, Right, Bottom;
    }
    [StructLayout(LayoutKind.Sequential)] private struct GuiThreadInfo {
      public uint Size, Flags;
      public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
      public Rect CaretRect;
    }
    [StructLayout(LayoutKind.Sequential)] private struct NativeMessage {
      public IntPtr Window;
      public uint Message;
      public UIntPtr WParam;
      public IntPtr LParam;
      public uint Time;
      public int PointX, PointY;
      public uint Private;
    }
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation {
      public uint Attributes;
      public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime;
      public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation information);
    private delegate bool EnumProc(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr state);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern int MapWindowPoints(IntPtr from, IntPtr to, ref Rect rect, uint points);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr SetActiveWindow(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo information);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out NativeMessage message, IntPtr window, uint minimum, uint maximum, uint remove);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int DrawText(IntPtr dc, string text, int length, ref Rect rect, uint format);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr window, int index);

    public static void UsePhysicalCoordinates() {
      // This changes only the harness coordinate system, never the installer's
      // DPI. Report the actual installer DPI; do not claim simulated coverage.
      SetThreadDpiAwarenessContext(new IntPtr(-4));
    }

    public static string DirectoryIdentity(string path, bool allowMissing) {
      // Identify the real filesystem object, not its name, timestamp or bytes.
      // Share read/write/delete and close immediately, so this observation does
      // not prevent an actual installer rename or background backup cleanup.
      // BACKUP_SEMANTICS | OPEN_REPARSE_POINT avoids following a substituted link.
      using (var directory = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
        if (directory.IsInvalid) {
          var error = Marshal.GetLastWin32Error();
          if (allowMissing && (error == 2 || error == 3)) return null;
          throw new Win32Exception(error, "Cannot identify directory: " + path);
        }
        FileInformation information;
        if (!GetFileInformationByHandle(directory, out information)) throw new Win32Exception();
        if ((information.Attributes & 0x10) == 0 || (information.Attributes & 0x400) != 0)
          throw new InvalidOperationException("Expected a real directory, not a file or reparse point: " + path);
        return information.VolumeSerialNumber.ToString("X8") + ":" +
          information.FileIndexHigh.ToString("X8") + information.FileIndexLow.ToString("X8");
      }
    }

    private static WindowInfo Inspect(IntPtr window) {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      var text = new StringBuilder(4096);
      var className = new StringBuilder(256);
      GetWindowText(window, text, text.Capacity);
      GetClassName(window, className, className.Capacity);
      Rect bounds;
      if (!GetWindowRect(window, out bounds)) {
        // Capture this call's error, not an unrelated cached P/Invoke error
        // (for example ERROR_NO_TOKEN left by another Windows API).
        var error = Marshal.GetLastWin32Error();
        throw new Win32Exception(error, "GetWindowRect failed for HWND " + window.ToInt64() + ": win32=" + error);
      }
      return new WindowInfo {
        Handle = window.ToInt64(), OwnerHandle = GetWindow(window, 4).ToInt64(), ProcessId = (int)processId,
        ControlId = GetDlgCtrlID(window), ClassName = className.ToString(),
        Text = text.ToString(), Visible = IsWindowVisible(window),
        Enabled = IsWindowEnabled(window), Left = bounds.Left, Top = bounds.Top,
        Width = bounds.Right - bounds.Left, Height = bounds.Bottom - bounds.Top,
        Dpi = GetDpiForWindow(window)
      };
    }

    private static bool TryInspectSnapshot(IntPtr window, out WindowInfo info) {
      info = null;
      try {
        var observed = Inspect(window);
        // Enumeration does not keep HWNDs alive. Exiting helper windows and
        // removed child controls can disappear between the individual reads.
        uint currentProcessId;
        if (GetWindowThreadProcessId(window, out currentProcessId) == 0 ||
            currentProcessId != observed.ProcessId) return false;
        info = observed;
        return true;
      } catch (Win32Exception error) {
        // Only snapshot enumeration tolerates a disappeared HWND. Real target
        // clicks, modal checks and captures still use strict Inspect directly.
        if (error.NativeErrorCode == 1400 || !IsWindow(window)) return false;
        throw;
      }
    }

    public static WindowInfo[] Windows() {
      var windows = new List<WindowInfo>();
      EnumWindows((window, state) => {
        WindowInfo info;
        if (IsWindowVisible(window) && TryInspectSnapshot(window, out info)) windows.Add(info);
        return true;
      }, IntPtr.Zero);
      return windows.ToArray();
    }

    public static WindowInfo[] Controls(long parent) {
      var controls = new List<WindowInfo>();
      EnumChildWindows(new IntPtr(parent), (window, state) => {
        WindowInfo info;
        if (TryInspectSnapshot(window, out info)) controls.Add(info);
        return true;
      }, IntPtr.Zero);
      return controls.ToArray();
    }

    public static int Checked(long handle) {
      return SendMessage(new IntPtr(handle), 0x00F0, IntPtr.Zero, IntPtr.Zero).ToInt32();
    }

    public static WindowInfo FindDialogAcknowledgement(long dialog, int expectedProcessId,
        string expectedTitle, string expectedBodyPattern, long expectedOwner) {
      var info = Inspect(new IntPtr(dialog));
      if (!info.Visible || !info.Enabled || info.ClassName != "#32770" ||
          info.ProcessId != expectedProcessId || info.Text != expectedTitle) return null;
      if (expectedOwner != 0) {
        if (info.OwnerHandle != expectedOwner) return null;
        var owner = Inspect(new IntPtr(expectedOwner));
        if (owner.ProcessId != expectedProcessId || !owner.Visible || owner.Enabled) return null;
      }
      var buttons = new List<WindowInfo>();
      bool hasExpectedBody = false;
      foreach (var control in Controls(dialog)) {
        if (!control.Visible) continue;
        if (control.ClassName == "Button") buttons.Add(control);
        if (control.ClassName == "Static" && Regex.IsMatch(control.Text, expectedBodyPattern,
            RegexOptions.CultureInvariant)) hasExpectedBody = true;
      }
      if (!hasExpectedBody || buttons.Count != 1 || !buttons[0].Enabled) return null;
      var label = Regex.Replace(buttons[0].Text.Replace("&", ""), @"\s*\([A-Za-z]\)", "").Trim();
      // MB_OK may expose IDCANCEL (2), not IDOK (1), on the actual Windows
      // dialog. Its one visible acknowledgement action is the semantic proof.
      if (!String.Equals(label, "OK", StringComparison.OrdinalIgnoreCase) &&
          label != "\u786e\u5b9a" && label != "\u78ba\u5b9a") return null;
      return buttons[0];
    }

    public static void ClickDialogAcknowledgement(long dialog, int expectedProcessId,
        string expectedTitle, string expectedBodyPattern, long expectedOwner) {
      // Re-inspect the same HWND immediately before clicking. A screenshot or
      // a previously discovered button is not authority to click another dialog.
      var button = FindDialogAcknowledgement(dialog, expectedProcessId, expectedTitle,
        expectedBodyPattern, expectedOwner);
      if (button == null) throw new InvalidOperationException("Expected unique acknowledgement dialog is no longer available");
      Click(button.Handle);
    }

    public static void Click(long handle) {
      var window = new IntPtr(handle);
      var control = Inspect(window);
      if (!control.Visible || !control.Enabled || control.ClassName != "Button")
        throw new InvalidOperationException("Cannot click an invisible, disabled, or non-button control: " + control.Text);
      // BM_CLICK reaches the same NSIS control callback as a user click.
      // Posting keeps the driver responsive during real synchronous install work.
      if (!PostMessage(window, 0x00F5, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
    }

    public static long ForegroundWindowHandle() { return GetForegroundWindow().ToInt64(); }

    private static long ActiveWindowForThread(uint thread) {
      var information = new GuiThreadInfo { Size = (uint)Marshal.SizeOf(typeof(GuiThreadInfo)) };
      if (!GetGUIThreadInfo(thread, ref information)) throw new Win32Exception();
      return information.Active.ToInt64();
    }

    public static ButtonClickReceipt ClickActiveDialogButton(long dialog, long handle) {
      var window = new IntPtr(handle);
      var parent = new IntPtr(dialog);
      var control = Inspect(window);
      var owner = Inspect(parent);
      if (!owner.Visible || !owner.Enabled || owner.ClassName != "#32770" ||
          !control.Visible || !control.Enabled || control.ClassName != "Button" ||
          control.ProcessId != owner.ProcessId || GetAncestor(window, 2) != parent)
        throw new InvalidOperationException("Button does not belong to the visible, enabled dialog");
      uint processId;
      var targetThread = GetWindowThreadProcessId(parent, out processId);
      var currentThread = GetCurrentThreadId();
      var receipt = new ButtonClickReceipt {
        DialogHandle = dialog, ButtonHandle = handle, ProcessId = control.ProcessId,
        ControlId = control.ControlId, Text = control.Text,
        ActiveBefore = ActiveWindowForThread(targetThread), ForegroundBefore = ForegroundWindowHandle()
      };
      var attached = false;
      try {
        // BM_CLICK can be ignored by an inactive dialog (Microsoft's documented
        // precondition). Attach only for this cross-thread activation and always
        // detach; never replace the real button action with wizard WM_COMMAND.
        if (currentThread != targetThread) {
          // AttachThreadInput fails if either thread has no input queue. The
          // target owns a dialog; explicitly create this PowerShell thread's
          // queue without consuming any messages (PM_NOREMOVE).
          NativeMessage pending;
          PeekMessage(out pending, IntPtr.Zero, 0, 0, 0);
          if (!AttachThreadInput(currentThread, targetThread, true)) throw new Win32Exception();
          attached = true;
        }
        SetForegroundWindow(parent);
        SetActiveWindow(parent);
        var elapsed = System.Diagnostics.Stopwatch.StartNew();
        do {
          receipt.ActiveAtClick = ActiveWindowForThread(targetThread);
          receipt.ForegroundAtClick = ForegroundWindowHandle();
          if (receipt.ActiveAtClick == dialog && receipt.ForegroundAtClick == dialog) break;
          System.Threading.Thread.Sleep(20);
        } while (elapsed.ElapsedMilliseconds < 2000);
        if (receipt.ActiveAtClick != dialog || receipt.ForegroundAtClick != dialog)
          throw new InvalidOperationException("Dialog activation failed before click: dialog=" + dialog +
            " active=" + receipt.ActiveAtClick + " foreground=" + receipt.ForegroundAtClick);
        var current = Inspect(parent);
        if (!current.Visible || !current.Enabled || current.ProcessId != control.ProcessId)
          throw new InvalidOperationException("Dialog changed before click");
        Click(handle);
        return receipt;
      } finally {
        if (attached) AttachThreadInput(currentThread, targetThread, false);
      }
    }

    public static void Close(long handle) {
      if (!PostMessage(new IntPtr(handle), 0x0010, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
    }

    public static void AssertActionLayout(long parent, long handle) {
      var window = new IntPtr(handle);
      var control = Inspect(window);
      if (!control.Visible || control.Width <= 0 || control.Height <= 0)
        throw new InvalidOperationException("Action is not visible: " + control.Text);
      Rect client;
      GetClientRect(new IntPtr(parent), out client);
      MapWindowPoints(new IntPtr(parent), IntPtr.Zero, ref client, 2);
      if (control.Left < client.Left || control.Top < client.Top ||
          control.Left + control.Width > client.Right || control.Top + control.Height > client.Bottom)
        throw new InvalidOperationException("Action is clipped by the wizard: " + control.Text);
      var dc = GetDC(window);
      var font = SendMessage(window, 0x0031, IntPtr.Zero, IntPtr.Zero);
      var oldFont = font == IntPtr.Zero ? IntPtr.Zero : SelectObject(dc, font);
      try {
        var measured = new Rect();
        // DT_CALCRECT | DT_SINGLELINE. Ampersands are access-key markers.
        DrawText(dc, control.Text, -1, ref measured, 0x0420);
        Rect inner;
        GetClientRect(window, out inner);
        var style = GetWindowLong(window, -16) & 0xF;
        var checkbox = style == 2 || style == 3 || style == 5 || style == 6;
        var allowance = checkbox ? (int)Math.Ceiling(20 * control.Dpi / 96.0) : 8;
        if (measured.Right - measured.Left + allowance > inner.Right - inner.Left ||
            measured.Bottom - measured.Top > inner.Bottom - inner.Top)
          throw new InvalidOperationException("Action text does not fit at " + control.Dpi + " DPI: " + control.Text);
      } finally {
        if (oldFont != IntPtr.Zero) SelectObject(dc, oldFont);
        ReleaseDC(window, dc);
      }
    }

    public static void Capture(long handle, string path) {
      var window = new IntPtr(handle);
      var info = Inspect(window);
      if (!info.Visible || info.Width <= 0 || info.Height <= 0)
        throw new InvalidOperationException("Cannot capture an invisible window");
      SetForegroundWindow(window);
      using (var bitmap = new Bitmap(info.Width, info.Height)) {
        using (var graphics = Graphics.FromImage(bitmap)) {
          var dc = graphics.GetHdc();
          try {
            if (!PrintWindow(window, dc, 2)) throw new Win32Exception("PrintWindow failed");
          } finally { graphics.ReleaseHdc(dc); }
        }
        var colors = new HashSet<int>();
        for (int y = 0; y < bitmap.Height; y += 7)
          for (int x = 0; x < bitmap.Width; x += 7) colors.Add(bitmap.GetPixel(x, y).ToArgb());
        if (colors.Count < 8) throw new InvalidOperationException("Window capture is blank; interactive desktop evidence is unavailable");
        bitmap.Save(path, ImageFormat.Png);
      }
    }
  }
}
