package com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.mapper;

import static org.junit.jupiter.api.Assertions.*;

import com.baomidou.mybatisplus.test.autoconfigure.MybatisPlusTest;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.AutoFillObjectHandler;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.MybatisPlusConfig;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.UuidTypeHandler;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.id.UuidV7Generators;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.po.TenantPO;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase.Replace;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.test.annotation.Rollback;

@MybatisPlusTest(
    properties = {
      "spring.test.database.replace=none",
      "spring.datasource.url=jdbc:postgresql://localhost:5432/persimmon_scaffold",
      "spring.datasource.username=postgres",
      "spring.datasource.password=postgres",
      "spring.datasource.driver-class-name=org.postgresql.Driver",
      "spring.sql.init.mode=always",
      "spring.sql.init.schema-locations=classpath:schema.sql",
      "mybatis-plus.global-config.db-config.logic-delete-field=deletedAt",
      "mybatis-plus.global-config.db-config.logic-delete-value=now()",
      "mybatis-plus.global-config.db-config.logic-not-delete-value=null"
    })
@AutoConfigureTestDatabase(replace = Replace.NONE)
@Import({
  TenantMapperIT.MapperConfig.class,
  UuidTypeHandler.class,
  AutoFillObjectHandler.class,
  MybatisPlusConfig.class
})
@TestMethodOrder(OrderAnnotation.class)
@EnabledIfSystemProperty(named = "it.postgres", matches = "true")
class TenantMapperIT {
  private static final UuidV7Generators uuidV7Generators = new UuidV7Generators();
  private static final UUID id = uuidV7Generators.next();

  @Autowired private TenantMapper tenantMapper;

  @Test
  @Order(1)
  @Rollback(false)
  void testInsert() {
    TenantPO po = new TenantPO();
    po.setId(id);
    po.setName("Acme");
    po.setEmail("acme@example.com");
    po.setPlan("BASIC");
    po.setStatus("PROVISIONING");
    int insert = tenantMapper.insert(po);
    assertEquals(1, insert);
  }

  @Test
  @Order(2)
  void testSelect() {
    List<TenantPO> list = tenantMapper.selectList(null);
    assertNotNull(list);
    assertFalse(list.isEmpty());
    TenantPO first = list.getFirst();
    assertEquals(id, first.getId());
    assertEquals("Acme", first.getName());
    assertNotNull(first.getCreatedAt());
    assertNotNull(first.getUpdatedAt());
    assertNull(first.getDeletedAt());
  }

  @Test
  @Order(3)
  @Rollback(false)
  void testUpdate() {
    TenantPO before = tenantMapper.selectById(id);
    assertNotNull(before);

    TenantPO patch = new TenantPO();
    patch.setId(id);
    patch.setName("Acme-2");
    patch.setStatus("ACTIVE");
    int updated = tenantMapper.updateById(patch);
    assertEquals(1, updated);

    TenantPO after = tenantMapper.selectById(id);
    assertNotNull(after);
    assertEquals("Acme-2", after.getName());
    assertEquals("ACTIVE", after.getStatus());
    assertTrue(after.getUpdatedAt().isAfter(before.getUpdatedAt()));
  }

  @Test
  @Order(4)
  @Rollback(false)
  void testOptimisticLock() {
    TenantPO current = tenantMapper.selectById(id);
    assertNotNull(current);
    assertNotNull(current.getRowVersion());
    Integer v0 = current.getRowVersion();

    TenantPO ok = new TenantPO();
    ok.setId(id);
    ok.setRowVersion(v0);
    ok.setStatus("ACTIVE");
    ok.setName("Acme-optimistic-ok");
    int updated1 = tenantMapper.updateById(ok);
    assertEquals(1, updated1);

    TenantPO afterOk = tenantMapper.selectById(id);
    assertNotNull(afterOk);
    assertEquals(v0 + 1, afterOk.getRowVersion());

    TenantPO stale = new TenantPO();
    stale.setId(id);
    stale.setRowVersion(v0);
    stale.setName("Acme-optimistic-stale");
    stale.setStatus("FAILED");
    int updated2 = tenantMapper.updateById(stale);
    assertEquals(0, updated2);

    TenantPO afterStale = tenantMapper.selectById(id);
    assertNotNull(afterStale);
    assertEquals(v0 + 1, afterStale.getRowVersion());
    assertEquals("Acme-optimistic-ok", afterStale.getName());
  }

  @Test
  @Order(5)
  @Rollback(false)
  void testDelete() {
    int deleted = tenantMapper.deleteById(id);
    assertEquals(1, deleted);
    TenantPO after = tenantMapper.selectById(id);
    assertNotNull(after);
    assertNotNull(after.getDeletedAt());
  }

  @Configuration
  @MapperScan("com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.mapper")
  static class MapperConfig {}
}
