package com.ryan.persimmon.infra.repository.biz.mapper;

import static org.junit.jupiter.api.Assertions.*;

import com.baomidou.mybatisplus.test.autoconfigure.MybatisPlusTest;
import com.ryan.persimmon.infra.common.database.AutoFillObjectHandler;
import com.ryan.persimmon.infra.common.database.MybatisPlusConfig;
import com.ryan.persimmon.infra.common.database.UuidTypeHandler;
import com.ryan.persimmon.infra.common.id.UuidV7Generators;
import com.ryan.persimmon.infra.repository.biz.po.DemoBizPO;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
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
  DemoBizMapperTest.MapperConfig.class,
  UuidTypeHandler.class,
  AutoFillObjectHandler.class,
  MybatisPlusConfig.class
})
@TestMethodOrder(OrderAnnotation.class)
class DemoBizMapperTest {
  private static final UuidV7Generators uuidV7Generators = new UuidV7Generators();
  private static final UUID id = uuidV7Generators.next();
  private final String name = "test-01";
  @Autowired private DemoBizMapper demoBizMapper;

  @Test
  @Order(1)
  @Rollback(value = false)
  void testInsert() {
    DemoBizPO demoBizPO = new DemoBizPO();
    demoBizPO.setName(name);
    demoBizPO.setStatus("CREATING");
    demoBizPO.setId(id);
    int insert = demoBizMapper.insert(demoBizPO);
    assertEquals(1, insert);
  }

  @Test
  @Order(2)
  void testSelect() {
    List<DemoBizPO> list = demoBizMapper.selectList(null);
    assertNotNull(list);
    assertFalse(list.isEmpty());
    assertEquals(1, list.size());
    assertEquals(name, list.getFirst().getName());
    assertNotNull(list.getFirst().getCreatedAt());
    assertNotNull(list.getFirst().getUpdatedAt());
  }

  @Test
  @Order(3)
  @Rollback(value = false)
  void testUpdate() {
    // query first
    DemoBizPO demoBizPO = demoBizMapper.selectById(id);

    DemoBizPO newDemoBizPO = new DemoBizPO();
    newDemoBizPO.setId(id);
    newDemoBizPO.setName("test-02");
    newDemoBizPO.setStatus("UPDATING");

    int update = demoBizMapper.updateById(newDemoBizPO);
    assertEquals(1, update);

    // query again
    DemoBizPO updated = demoBizMapper.selectById(id);
    assertTrue(updated.getUpdatedAt().isAfter(demoBizPO.getUpdatedAt()));
  }

  @Test
  @Order(4)
  @Rollback(false)
  void testOptimisticLock() {
    DemoBizPO current = demoBizMapper.selectById(id);
    assertNotNull(current);
    assertNotNull(current.getRowVersion());

    Integer v0 = current.getRowVersion();

    // 1) Update with correct rowVersion should succeed and increment version by 1
    DemoBizPO ok = new DemoBizPO();
    ok.setId(id);
    ok.setRowVersion(v0);
    ok.setName("test-optimistic-ok");
    ok.setStatus("UPDATING");

    int updated1 = demoBizMapper.updateById(ok);
    assertEquals(1, updated1);

    DemoBizPO afterOk = demoBizMapper.selectById(id);
    assertNotNull(afterOk);
    assertEquals(v0 + 1, afterOk.getRowVersion());
    assertEquals("test-optimistic-ok", afterOk.getName());

    // 2) Update again with a stale `rowVersion`, expect failure (return 0) and no data overwrite
    DemoBizPO stale = new DemoBizPO();
    stale.setId(id);
    stale.setRowVersion(v0); // Old version
    stale.setName("test-optimistic-stale");
    stale.setStatus("FAILED");

    int updated2 = demoBizMapper.updateById(stale);
    assertEquals(0, updated2);

    DemoBizPO afterStale = demoBizMapper.selectById(id);
    assertNotNull(afterStale);
    assertEquals(v0 + 1, afterStale.getRowVersion());
    assertEquals("test-optimistic-ok", afterStale.getName());
  }

  @Test
  @Order(5)
  @Rollback(value = false)
  void testDelete() {
    int i = demoBizMapper.deleteById(id);
    assertEquals(1, i);
  }

  @Configuration
  @MapperScan("com.ryan.persimmon.infra.repository.biz.mapper")
  static class MapperConfig {}
}
