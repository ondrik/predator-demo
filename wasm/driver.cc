// Predator in one process: clang (C -> LLVM IR) + the passes Predator's LLVM front-end expects
// (-lowerswitch -global-vars -nestedgep) + Predator itself (-sl).  This mirrors the pipeline of
// Predator's own test-suite:
//
//   clang -g -m64 -S -emit-llvm -Xclang -fsanitize-address-use-after-scope file.c -o - |
//   opt -lowerswitch -load libpasses.so -global-vars -nestedgep -load libsl.so -sl -args=...
//
// Usage: predator FILE.c [Predator options, e.g. -args=oom]
//
// The clang resource headers are expected in /clang/include, the libc headers (musl, x86_64) in
// /usr/include and Predator's builtins in /predator (all embedded in the WebAssembly module).

#include "clang/Basic/DiagnosticOptions.h"
#include "clang/CodeGen/CodeGenAction.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/CompilerInvocation.h"
#include "clang/Frontend/TextDiagnosticPrinter.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/LegacyPassManager.h"
#include "llvm/IR/Module.h"
#include "llvm/Pass.h"
#include "llvm/PassInfo.h"
#include "llvm/PassRegistry.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/raw_ostream.h"
#include "llvm/Transforms/Utils.h"

#include <cstdlib>
#include <memory>
#include <string>
#include <vector>

using namespace llvm;

int main(int argc, char **argv) {
    if (argc < 2) {
        errs() << "usage: " << argv[0] << " FILE.c [Predator options]\n";
        return 2;
    }
    const std::string file = argv[1];
    std::string base = file.substr(file.find_last_of('/') + 1);
    // PREDATOR_ROOT prefixes the header directories (for testing a native build of this driver)
    const char *rootEnv = getenv("PREDATOR_ROOT");
    const std::string root = rootEnv ? rootEnv : "";
    const std::string resDir = root + "/clang", resInc = root + "/clang/include",
                      libcInc = root + "/usr/include", builtinsInc = root + "/predator";

    // 1. C -> LLVM IR
    std::vector<const char *> cc1 = {
        "-triple", "x86_64-unknown-linux-gnu",
        "-emit-llvm",
        "-debug-info-kind=constructor", "-dwarf-version=5", "-debugger-tuning=gdb",
        "-fsanitize-address-use-after-scope",
        "-nostdsysteminc",
        "-resource-dir", resDir.c_str(),
        "-internal-isystem", resInc.c_str(),
        "-internal-externc-isystem", libcInc.c_str(),
        "-I", builtinsInc.c_str(),
        "-D", "PREDATOR",
        "-w",
        "-fgnuc-version=4.2.1",
        "-ferror-limit", "19",
        "-main-file-name", base.c_str(),
        "-x", "c", file.c_str(),
    };

    IntrusiveRefCntPtr<clang::DiagnosticOptions> diagOpts = new clang::DiagnosticOptions();
    auto *diagPrinter = new clang::TextDiagnosticPrinter(errs(), &*diagOpts);
    IntrusiveRefCntPtr<clang::DiagnosticIDs> diagIDs(new clang::DiagnosticIDs());
    clang::DiagnosticsEngine diags(diagIDs, &*diagOpts, diagPrinter);

    auto ci = std::make_unique<clang::CompilerInstance>();
    if (!clang::CompilerInvocation::CreateFromArgs(ci->getInvocation(), cc1, diags))
        return 2;
    ci->createDiagnostics();

    LLVMContext ctx;
    clang::EmitLLVMOnlyAction act(&ctx);
    if (!ci->ExecuteAction(act))
        return 3;  // compilation errors were printed by clang
    std::unique_ptr<Module> mod = act.takeModule();
    if (!mod)
        return 3;

    // 2. Predator's options (cl::opt in its LLVM front-end)
    std::vector<const char *> opts = {"predator", "-preserve-ec"};
    for (int i = 2; i < argc; ++i)
        opts.push_back(argv[i]);
    if (!cl::ParseCommandLineOptions(opts.size(), opts.data(), "Predator\n", &errs()))
        return 2;

    // 3. -lowerswitch -global-vars -nestedgep -sl
    PassRegistry &reg = *PassRegistry::getPassRegistry();
    legacy::PassManager pm;
    pm.add(createLowerSwitchPass());
    for (const char *name : {"global-vars", "nestedgep", "sl"}) {
        const PassInfo *info = reg.getPassInfo(StringRef(name));
        if (!info) {
            errs() << "internal error: pass '" << name << "' is not linked in\n";
            return 4;
        }
        pm.add(info->createPass());
    }
    pm.run(*mod);
    errs().flush();
    return 0;
}
