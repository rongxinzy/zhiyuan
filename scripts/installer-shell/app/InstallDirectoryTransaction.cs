using System.Text.Json;

namespace ZhiYuan.Setup.Shell;

/// <summary>Owns only the application directory. A durable sibling journal
/// makes a killed upgrade recoverable without reading or deleting user data.</summary>
internal sealed class InstallDirectoryTransaction
{
    private readonly string installDir;
    private readonly string journalPath;
    private TransactionState? state;

    internal sealed record TransactionState(string InstallDir, string? BackupDir, bool Committed);

    public InstallDirectoryTransaction(string installDir)
    {
        this.installDir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(installDir));
        journalPath = this.installDir + ".setup-state.json";
    }

    public bool HasPendingState => File.Exists(journalPath);
    public bool IsCommitted => ReadState()?.Committed == true;
    public string? BackupDir => state?.BackupDir;

    public void ValidateOwnership()
    {
        ValidatePhysicalDirectoryPath(installDir);
        ValidatePhysicalDirectoryPath(Path.Combine(installDir, "resources"));
        // Reading a journal validates its directory binding without mutation.
        // It also permits an interrupted partial extraction to be recovered.
        if (ReadState() is not null) return;
        if (Directory.Exists(installDir) && Directory.EnumerateFileSystemEntries(installDir).Any())
            ValidateInstalledApplication(installDir);
    }

    internal static void ValidateInstalledApplication(string root)
    {
        ValidatePhysicalDirectoryPath(Path.Combine(root, "resources"));
        foreach (var file in new[] { Path.Combine(root, InstallerEngine.AppExeName),
            Path.Combine(root, "resources", "app.asar") })
        {
            if (!ValidatePhysicalFileIfPresent(file))
                throw new EngineException("所选目录不包含完整的知远应用文件，或应用文件是链接，未修改任何文件。");
        }
    }

    private static bool ValidatePhysicalFileIfPresent(string file)
    {
        FileAttributes attributes;
        try { attributes = File.GetAttributes(file); }
        catch (FileNotFoundException) { return false; }
        catch (DirectoryNotFoundException) { return false; }
        if ((attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)
            throw new EngineException("应用文件和安装恢复记录必须是普通文件，不能是链接。");
        return true;
    }

    public void Begin()
    {
        if (HasPendingState) throw new EngineException("上次安装尚未恢复，请重试安装。");
        ValidateOwnership();
        var exists = Directory.Exists(installDir);
        var backup = exists ? installDir + ".old." + Guid.NewGuid().ToString("n") : null;
        state = new TransactionState(installDir, backup, false);
        WriteState(); // Persist before the rename so a crash never loses the old tree.
        if (backup is not null) Directory.Move(installDir, backup);
    }

    public void MarkCommitted()
    {
        state = (state ?? throw new InvalidOperationException("No install transaction")) with { Committed = true };
        WriteState();
    }

    public void Finish()
    {
        File.Delete(journalPath);
        state = null;
    }

    public void Rollback(bool preserveJournal = false)
    {
        var pending = ReadState();
        if (pending is null || pending.Committed) return;
        ValidateRecoveryPaths(pending);
        if (pending.BackupDir is null)
        {
            DeleteTreeWithoutFollowingLinks(installDir);
        }
        else if (Directory.Exists(pending.BackupDir))
        {
            // Extraction creates a new directory at the original path. Remove
            // that partial tree before moving the previous installation back.
            DeleteTreeWithoutFollowingLinks(installDir);
            Directory.Move(pending.BackupDir, installDir);
        }
        // With no backup, the rename never happened: leave the original alone.
        if (!preserveJournal) Finish();
    }

    private TransactionState? ReadState()
    {
        if (state is not null) return state;
        if (!ValidatePhysicalFileIfPresent(journalPath)) return null;
        var pending = JsonSerializer.Deserialize<TransactionState>(File.ReadAllText(journalPath))
            ?? throw new EngineException("安装恢复记录损坏，请保留现有文件并重新运行安装程序。");
        var expectedPrefix = installDir + ".old.";
        if (!string.Equals(pending.InstallDir, installDir, StringComparison.OrdinalIgnoreCase) ||
            (pending.BackupDir is not null &&
             (!pending.BackupDir.StartsWith(expectedPrefix, StringComparison.OrdinalIgnoreCase) ||
              !Guid.TryParseExact(pending.BackupDir[expectedPrefix.Length..], "n", out _))))
            throw new EngineException("安装恢复记录不属于所选目录，未修改任何安装文件。");
        ValidateRecoveryPaths(pending);
        state = pending;
        return state;
    }

    private void ValidateRecoveryPaths(TransactionState pending)
    {
        ValidatePhysicalDirectoryPath(Path.Combine(installDir, "resources"));
        ValidatePhysicalFileIfPresent(Path.Combine(installDir, InstallerEngine.AppExeName));
        ValidatePhysicalFileIfPresent(Path.Combine(installDir, "resources", "app.asar"));
        if (pending.Committed)
        {
            ValidateInstalledApplication(installDir);
        }
        if (pending.BackupDir is null) return; // A journal-owned first-install partial tree may have no identity yet.
        ValidatePhysicalDirectoryPath(Path.Combine(pending.BackupDir, "resources"));
        if (Directory.Exists(pending.BackupDir))
        {
            // Begin also detaches a pre-existing empty directory. It has no
            // application identity, but is safe to restore as an empty folder.
            if (Directory.EnumerateFileSystemEntries(pending.BackupDir).Any())
                ValidateInstalledApplication(pending.BackupDir);
        }
        else if (Directory.Exists(installDir) && Directory.EnumerateFileSystemEntries(installDir).Any())
        {
            // The rename never happened, or an earlier rollback restored it.
            ValidateInstalledApplication(installDir);
        }
    }

    private void WriteState()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(journalPath)!);
        var temporary = journalPath + ".tmp." + Guid.NewGuid().ToString("n");
        try
        {
            using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(file, state);
                file.Flush(flushToDisk: true);
            }
            File.Move(temporary, journalPath, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    internal static void ValidateRoots(string installDir, string runtimeRoot, string appDataRoot)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(installDir));
        if (string.Equals(full, Path.GetPathRoot(full), StringComparison.OrdinalIgnoreCase) ||
            full.StartsWith(@"\\", StringComparison.Ordinal) ||
            full.Contains('"') || full.Contains('\r') || full.Contains('\n'))
            throw new EngineException("请选择本机的独立应用安装目录。");
        foreach (var protectedRoot in new[] { appDataRoot, runtimeRoot })
        {
            if (ContainsPath(full, protectedRoot) || ContainsPath(protectedRoot, full))
                throw new EngineException("安装目录不能与个人数据或运行环境目录重叠。");
        }
        foreach (var folder in new[] { Environment.SpecialFolder.UserProfile,
            Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.MyDocuments,
            Environment.SpecialFolder.ApplicationData, Environment.SpecialFolder.LocalApplicationData,
            Environment.SpecialFolder.Windows, Environment.SpecialFolder.System,
            Environment.SpecialFolder.SystemX86, Environment.SpecialFolder.ProgramFiles,
            Environment.SpecialFolder.ProgramFilesX86 })
        {
            var protectedRoot = Environment.GetFolderPath(folder);
            var protectsDescendants = folder is Environment.SpecialFolder.Windows
                or Environment.SpecialFolder.System or Environment.SpecialFolder.SystemX86;
            if (!string.IsNullOrEmpty(protectedRoot) &&
                (ContainsPath(full, protectedRoot) || (protectsDescendants && ContainsPath(protectedRoot, full))))
                throw new EngineException("请选择独立的应用文件夹，不要选择系统或个人文件根目录。");
        }
        foreach (var root in new[] { full, runtimeRoot, appDataRoot })
            ValidatePhysicalDirectoryPath(root);
    }

    private static void ValidatePhysicalDirectoryPath(string root)
    {
        for (var dir = new DirectoryInfo(root); dir is not null; dir = dir.Parent)
        {
            FileAttributes attributes;
            try { attributes = File.GetAttributes(dir.FullName); }
            catch (FileNotFoundException) { continue; }
            catch (DirectoryNotFoundException) { continue; }
            if ((attributes & FileAttributes.ReparsePoint) != 0)
                throw new EngineException("安装目录不能通过目录链接指向其他位置。");
            if ((attributes & FileAttributes.Directory) == 0)
                throw new EngineException("安装路径的上级必须是文件夹。");
        }
    }

    private static bool ContainsPath(string parent, string child)
    {
        var normalized = Path.TrimEndingDirectorySeparator(Path.GetFullPath(parent));
        var candidate = Path.TrimEndingDirectorySeparator(Path.GetFullPath(child));
        return candidate.Equals(normalized, StringComparison.OrdinalIgnoreCase) ||
            candidate.StartsWith(normalized + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    internal static void DeleteTreeWithoutFollowingLinks(string root)
    {
        FileAttributes attributes;
        try { attributes = File.GetAttributes(root); }
        catch (FileNotFoundException) { return; }
        catch (DirectoryNotFoundException) { return; }
        if ((attributes & FileAttributes.ReparsePoint) != 0)
        {
            if ((attributes & FileAttributes.Directory) != 0) Directory.Delete(root);
            else File.Delete(root); // Dangling directory symlinks may no longer carry Directory.
            return;
        }
        foreach (var file in Directory.EnumerateFiles(root)) File.Delete(file);
        foreach (var child in Directory.EnumerateDirectories(root)) DeleteTreeWithoutFollowingLinks(child);
        Directory.Delete(root);
    }
}
