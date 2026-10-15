namespace ZhiYuan.Setup.Shell;

// Accessed only on the form's UI thread. Start acknowledges admission after
// Begin, so a subsequent cancel always targets the token captured by the
// worker. Complete is called only after that worker (including rollback) exits.
internal sealed class SetupOperation : IDisposable
{
    private CancellationTokenSource cancellation = new();

    public bool IsActive { get; private set; }

    public CancellationToken Begin()
    {
        if (IsActive) throw new InvalidOperationException("A setup operation is already active");
        IsActive = true;
        return cancellation.Token;
    }

    public void Cancel()
    {
        if (IsActive) cancellation.Cancel();
    }

    public void Complete()
    {
        IsActive = false;
        cancellation.Dispose();
        cancellation = new CancellationTokenSource();
    }

    public void Dispose() => cancellation.Dispose();
}
