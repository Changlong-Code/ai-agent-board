# 原项目 Windows 基础版 M2 运行说明

本包保存原版 React/Express/SQLite 代码与M1/M2修改，不是另做的离线看板。当前为开发检查点，Linux完整门禁通过，Windows1909实机未验收，M2尚未完成。

## 在你的电脑上恢复运行

1. 完整解压到固定目录；本机需要能运行的Node22.12+和npm。
2. 首次运行 `Setup-Original-Board.cmd`，联网安装锁定依赖并构建；失败时保留提示，不自动安装系统编译工具或启动AI。
3. 运行 `Diagnose-Original-Board.cmd` 检查当前环境。
4. 运行 `Verify-Original-Board.cmd`，在临时目录验证任务与重启持久化；不访问业务项目。
5. 运行 `Start-Original-Board.cmd`；原版页面默认 http://127.0.0.1:8776 ，API为8777，可编辑ORIGINAL_PORTS.json。
6. Ctrl+C正常停止；不按进程名批量结束其他Node程序。

基础版默认禁用全部AI执行，不需要CLI或登录才能创建/编辑/拖动任务。数据库、配置、附件、日志位于 `%LOCALAPPDATA%\AI-Agent-Board\original-basic`（可由ORIGINAL_BOARD_HOME指定），与0.2.x伴随版本分离，不自动导入旧库或浏览器任务。

## 数据保护和恢复

启动已有数据库前先用SQLite backup API生成含已提交WAL内容的快照，成功后才允许迁移。快照在独立目录的backups，日志在logs。无效配置保留原件和时间戳副本并停止启动。

停止看板后运行 `Backup-Original-Board.cmd`，生成 snapshots 下的完整受限快照，包含数据库、上传附件和配置；不包含项目源码、依赖、日志或凭据。启动时 backups 下的自动数据库快照不替代此完整快照。请另行复制 snapshots 到安全位置。

运行 `Restore-Original-Board.cmd`，输入快照目录后先查看预览；只有准确输入快照 ID 才会实际恢复，回车取消。恢复会验证文件清单、哈希和数据库，先备份当前数据，再保留整个旧目录；异常时尝试回滚。当前数据库或配置损坏、无法制作安全快照时拒绝覆盖，需要人工修复。

若出现 restore-in-progress.json，表示恢复未确认完成；启动和新的备份/恢复均被阻止。保留标记、restore-recovery 和 snapshots，先检查恢复记录及旧数据，再人工恢复；不要直接删除标记后启动。本实现未验证 Windows 断电一致性。

诊断和自检报告自动保存在解压目录 reports 下，可用 ORIGINAL_REPORT_DIR 指定位置。诊断不读取业务项目和账号。自检使用独立临时数据、动态端口，不调用 AI；静态 React 资源检查不等于浏览器交互实测。异常退出时会保留临时数据供排查。

重复启动或异常关闭遗留original.lock会拒绝启动；确认本程序全部停止后才能手动移除该锁。端口占用请改端口，不结束其他项目。卸载前备份后删除解压目录，不自动删除用户数据。

## 当前证据与下一步

完整gate：86服务合同+3Hermes通过，React/服务构建通过，E2E180通过、4项既有真实Agent测试跳过。独立原版启动器浏览器实测通过。详见windows/original-required-gate.log、original-ui-results.json、ORIGINAL_REVIEW.md。

包内不包含node_modules、Node.exe或用户数据库。包含已生成的JS构建产物作为断点证据；在Windows仍应执行Setup以安装目标平台原生依赖并重新构建。

继续开发入口：WORK_CHECKPOINT.md末尾“原项目M1/M2断点”。先完成目标Windows实机，再推进M3授权隔离与M4真实CLI接入。本批已继续完成诊断、自检和受控备份恢复，详见 windows/ORIGINAL_M2_TEST_REPORT.md；M1/M2 仍待目标 Windows 实测。
